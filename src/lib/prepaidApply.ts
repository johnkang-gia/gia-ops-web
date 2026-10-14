import type { SupabaseClient } from "@supabase/supabase-js";
import { splitMemo, leftoverMemo } from "@/lib/prepaid";
import { planDeduction, firstFitLines, depositBalance, isFromDeposit, groupLines, type LineNeed } from "@/lib/depositLines";
import { poolOf } from "@/lib/depositShare";

/**
 * **예치금을 청구서 항목에 붙이고 떼는 일** — 표를 고치는 곳은 여기 하나입니다.
 *
 * ── 왜 항목 단위인가 ─────────────────────────────────────────────────
 *
 * 예전에는 청구서 합계에서 금액만 깎았습니다. 그러면 청구서·영수증에 「예치금에서 무엇을
 * 냈는지」를 적을 수 없고, 학부모가 「그럼 남은 건 뭐예요」라고 물으면 행정실이 다시 셉니다.
 * 이제 뺄 때 **어느 항목을 덮는지**를 돈 쪽(`payments.applied_line_id`)에 적고, 통째로 덮은
 * 항목은 항목 쪽(`invoice_lines.paid_payment_id`)에도 적습니다 - 결제 창이 그 항목을 「이미
 * 받은 항목」으로 보여줘야 두 번 받지 않습니다.
 *
 * 계산 규칙은 `depositLines.ts`(시험 가능), 여기서는 그 계획대로 고칩니다.
 *
 * ── 조용히 실패하지 않습니다 ─────────────────────────────────────────
 *
 * 붙이다 실패하면 **청구서는 그대로 두고 사실만 알립니다.** 청구서를 지우면 방금 만든
 * 종이가 사라지고, 그냥 넘어가면 이미 받은 돈이 미납으로 남습니다.
 */

type DepositRow = {
  id: string;
  /** 이 돈을 맡긴 학생. 공유 묶음이면 청구서 주인과 다를 수 있습니다. */
  student_id: string;
  amount: number;
  paid_at: string;
  payer_name: string | null;
  origin: string | null;
  method: string | null;
  method_kind: string | null;
  matched_by: string | null;
};

/**
 * 이 학생이 쓸 수 있는 예치금 줄(청구서에 안 붙은 입금)과 잔액. **공유 묶음이면 묶음 전체의 줄**입니다
 * (`depositShare.ts`). 줄은 하나씩만 있으므로 형제가 같은 돈을 두 번 쓸 수 없습니다.
 */
export async function loadDeposits(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ rows: DepositRow[]; balance: number; memberIds: string[]; shareName: string | null; error: string | null }> {
  const pool = await poolOf(supabase, studentId);
  if (pool.error) return { rows: [], balance: 0, memberIds: [studentId], shareName: null, error: pool.error };
  const { data, error } = await supabase
    .from("payments")
    // **출처(`origin`)를 함께 읽습니다.** 쪼갠 조각이 뿌리의 출처를 물려받아야, 나중에
    // 청구서를 취소할 때 「이 돈은 발행이 만든 것」임을 알아볼 수 있습니다.
    .select("id, student_id, amount, paid_at, payer_name, origin, method, method_kind, matched_by")
    .in("student_id", pool.memberIds)
    .is("invoice_id", null)
    .order("paid_at");
  if (error) return { rows: [], balance: 0, memberIds: pool.memberIds, shareName: null, error: `남은 예치금을 읽지 못했습니다: ${error.message}` };
  const rows = ((data as (DepositRow & { amount: number | string })[] | null) ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
  return { rows, balance: depositBalance(rows), memberIds: pool.memberIds, shareName: pool.share?.name ?? null, error: null };
}

export type ApplyResult = {
  applied: number;
  /** 다 못 덮은 항목(예치금이 모자람). */
  partial: { lineId: string; covered: number; need: number } | null;
  left: number;
  error: string | null;
};

/**
 * 고른 항목을 **고른 순서대로** 예치금에서 덮습니다. 모자라면 마지막 항목만 일부를 덮습니다.
 *
 * `lines.amount` 는 그 항목에서 **아직 안 받은 금액**이어야 합니다 - 부르는 쪽이 셉니다.
 */
export async function applyDepositToLines(
  supabase: SupabaseClient,
  invoice: { id: string; invoice_no: string; student_id: string | null },
  lines: LineNeed[],
  actor: string,
  matchedBy: string,
  /** 이번에 뺄 **최대 금액**. 사람이 「이 청구서에서는 30만원만」이라고 정한 경우. 없으면 고른 항목 전부. */
  maxAmount?: number | null,
): Promise<ApplyResult> {
  const none: ApplyResult = { applied: 0, partial: null, left: 0, error: null };
  if (!invoice.student_id || lines.length === 0) return none;
  const owner = invoice.student_id;

  const dep = await loadDeposits(supabase, owner);
  if (dep.error) return { ...none, error: dep.error };
  const cap = maxAmount != null && maxAmount >= 0 ? Math.min(dep.balance, Math.round(maxAmount)) : dep.balance;
  // 자기 돈을 먼저 씁니다. 형제 돈부터 빼면 맡긴 아이 청구서를 낼 때 그 아이 돈이 남고 형제 돈이 비어
  // 「왜 둘째 예치금이 줄었나」를 설명해야 합니다. 같은 사람 돈 안에서는 먼저 들어온 것부터(`planDeduction`).
  const ordered = [...dep.rows].sort((a, b) => Number(a.student_id !== owner) - Number(b.student_id !== owner));
  const rank = new Map(ordered.map((r, i) => [r.id, i]));
  const plan = planDeduction(
    ordered.map((r) => ({ id: r.id, amount: r.amount, paidAt: `${r.student_id === owner ? "0" : "1"}|${r.paid_at}|${String(rank.get(r.id)).padStart(5, "0")}` })),
    lines,
    cap,
  );
  const appliedAt = new Date().toISOString();
  if (plan.applied <= 0) return { ...none, left: dep.balance };

  // 원래 예치금 줄 → 지금 그 돈이 들어 있는 줄. 쪼개면 남은 조각이 새 번호를 받습니다.
  const live = new Map(dep.rows.map((r) => [r.id, { ...r }]));

  for (const lp of plan.lines) {
    let firstPiece: string | null = null;
    for (const take of lp.takes) {
      const cur = live.get(take.depositId);
      if (!cur) return { ...none, error: "예치금 줄을 따라가지 못했습니다. 다시 열어 확인해주세요." };

      // 형제 돈이면 붙은 조각의 주인을 **청구서 주인**으로 바꾸고 원래 맡긴 학생을 남깁니다. 수납 합계는 모두
      // 청구서 주인 기준이라, 주인을 그대로 두면 그 돈이 형제 쪽 «받은 돈»으로 셈해집니다.
      const owned = cur.student_id === owner ? {} : { student_id: owner, shared_from_student_id: cur.student_id };
      if (take.amount >= cur.amount) {
        const { data: got, error } = await supabase
          .from("payments")
          // `origin` 은 건드리지 않습니다 - 이 칸이 덮어써지던 것이 「취소해도 안 지워지는 돈」의
          // 원인이었습니다(20261026 마이그레이션).
          .update({ invoice_id: invoice.id, matched_by: matchedBy, applied_line_id: lp.lineId, deposit_applied_at: appliedAt, ...owned })
          .eq("id", cur.id)
          .is("invoice_id", null)
          .select("id");
        if (error) return { ...none, applied: 0, error: `예치금을 붙이지 못했습니다: ${error.message}` };
        // **안 붙은 줄일 때만** 고칩니다. 0줄이면 그 사이 다른 청구서(형제 창 등)가 먼저 썼다는 뜻입니다 -
        // 그대로 넘어가면 이 청구서는 받은 줄 알고, 같은 돈이 두 장에 쓰인 것으로 보입니다.
        if (!got || got.length === 0) return { ...none, error: "그 사이 다른 청구서에서 이 예치금을 먼저 썼습니다. 창을 다시 열어 남은 예치금을 확인해주세요." };
        firstPiece ??= cur.id;
        live.delete(take.depositId);
        continue;
      }

      // 남는 돈을 **먼저** 떼어냅니다. 순서를 뒤집으면, 가운데서 끊겼을 때 원래 줄은 이미
      // 줄어 있고 남은 줄은 없어서 그만큼의 돈이 통째로 사라집니다.
      const rest = cur.amount - take.amount;
      const { data: made, error: newErr } = await supabase
        .from("payments")
        .insert({
          student_id: invoice.student_id,
          invoice_id: null,
          paid_at: cur.paid_at,
          amount: rest,
          method: cur.method,
          method_kind: cur.method_kind,
          payer_name: cur.payer_name,
          memo: leftoverMemo(cur.amount, take.amount, invoice.invoice_no),
          source: "쪼갬",
          // 남은 조각은 뿌리와 같은 예치금입니다 - 「청구 취소로 떼어냄」 같은 표시도 물려받아야
          // 예치금 대장이 이 돈의 사연을 그대로 보여줍니다.
          matched_by: cur.matched_by,
          // 쪼개도 **돈의 출처는 그대로**입니다. 안 물려주면 남은 조각이 「출처를 모르는
          // 선입금」이 되어, 청구서를 취소해도 안 지워지고 살아남습니다.
          origin: cur.origin,
          split_from_id: cur.id,
          created_by: actor,
          // 남는 조각은 **맡긴 학생** 것입니다(위 student_id). 공유 묶음 잔액에 그대로 남습니다.
        })
        .select("id")
        .single();
      if (newErr || !made) return { ...none, error: `남은 예치금을 나누지 못했습니다: ${newErr?.message ?? ""}` };

      const { data: cut, error: cutErr } = await supabase
        .from("payments")
        .update({
          invoice_id: invoice.id,
          amount: take.amount,
          matched_by: matchedBy,
          applied_line_id: lp.lineId,
          memo: splitMemo(cur.amount, take.amount, invoice.invoice_no),
          deposit_applied_at: appliedAt,
          ...owned,
        })
        .eq("id", cur.id)
        .is("invoice_id", null)
        .select("id");
      if (cutErr || !cut || cut.length === 0) {
        // 원래 줄을 못 잘랐으면(그 사이 다른 청구서가 썼거나 실패) 방금 떼어낸 조각을 지웁니다. 안 지우면
        // 원래 줄 + 조각이 함께 남아 같은 돈이 두 번 잡힙니다.
        const { error: undoErr } = await supabase.from("payments").delete().eq("id", (made as { id: string }).id);
        const why = cutErr ? cutErr.message : "그 사이 다른 청구서에서 이 예치금을 먼저 썼습니다";
        return {
          ...none,
          error: undoErr
            ? `예치금을 나눠 붙이지 못했고(${why}) 떼어낸 조각도 지우지 못했습니다(${undoErr.message}). 예치금 대장에서 ${rest.toLocaleString()}원 줄을 확인해주세요.`
            : `예치금을 나눠 붙이지 못했습니다: ${why}. 창을 다시 열어 확인해주세요.`,
        };
      }
      firstPiece ??= cur.id;
      live.set(take.depositId, { ...cur, id: (made as { id: string }).id, amount: rest });
    }

    // 통째로 덮은 항목만 「받은 항목」으로 표시합니다. 일부만 덮은 항목에 표시하면 결제 창이
    // 그 항목을 다 받은 것으로 빼버려, 나머지를 받을 자리가 없어집니다.
    if (lp.covered >= lp.need && firstPiece) {
      const members = lines.find((l) => l.id === lp.lineId)?.members ?? [lp.lineId];
      const { error: markErr } = await supabase
        .from("invoice_lines")
        .update({ paid_payment_id: firstPiece })
        .in("id", members)
        .is("paid_payment_id", null);
      if (markErr) {
        return { ...none, applied: plan.applied, error: `예치금은 붙였지만 어느 항목인지 표시하지 못했습니다: ${markErr.message}` };
      }
    }
  }

  return { applied: plan.applied, partial: plan.partial, left: plan.left, error: null };
}

/**
 * 이 청구서에 붙은 **예치금 차감을 전부 예치금으로 되돌립니다.** 돈은 지우지 않습니다 -
 * 청구서에서 떼어 학생 앞으로 다시 둘 뿐입니다.
 *
 * 항목 표시를 **먼저** 지웁니다. 거꾸로 하다 끊기면 「받은 항목」 표시가 없는 돈을 가리켜,
 * 결제 창이 그 항목을 영영 받은 것으로 봅니다.
 */
export async function releaseDeposit(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<{ released: number; error: string | null }> {
  const { data, error } = await supabase.from("payments").select("id, amount, matched_by, shared_from_student_id").eq("invoice_id", invoiceId);
  if (error) return { released: 0, error: `이 청구서의 입금을 읽지 못했습니다: ${error.message}` };
  type P = { id: string; amount: number | string; matched_by: string | null; shared_from_student_id: string | null };
  const mine = ((data as P[] | null) ?? []).filter((p) => isFromDeposit(p.matched_by));
  if (mine.length === 0) return { released: 0, error: null };
  const ids = mine.map((p) => p.id);

  const { error: lineErr } = await supabase.from("invoice_lines").update({ paid_payment_id: null }).in("paid_payment_id", ids);
  if (lineErr) return { released: 0, error: `항목 표시를 지우지 못해 되돌리지 않았습니다: ${lineErr.message}` };

  // 자기 돈은 한 번에, 형제 돈은 **맡긴 학생에게** 하나씩 돌려줍니다. 청구서 주인 앞으로 돌려두면 공유를 풀었을 때
  // 형제가 맡긴 돈이 이 아이 돈으로 남습니다.
  const own = mine.filter((p) => !p.shared_from_student_id).map((p) => p.id);
  if (own.length > 0) {
    const { error: backErr } = await supabase
      .from("payments")
      .update({ invoice_id: null, matched_by: "예치금", applied_line_id: null, deposit_applied_at: null })
      .in("id", own);
    if (backErr) return { released: 0, error: `예치금으로 되돌리지 못했습니다: ${backErr.message}` };
  }
  for (const p of mine.filter((x) => x.shared_from_student_id)) {
    const { error: backErr } = await supabase
      .from("payments")
      .update({
        invoice_id: null,
        matched_by: "예치금",
        applied_line_id: null,
        deposit_applied_at: null,
        student_id: p.shared_from_student_id,
        shared_from_student_id: null,
      })
      .eq("id", p.id);
    if (backErr) return { released: 0, error: `공유 예치금을 맡긴 학생에게 되돌리지 못했습니다: ${backErr.message}` };
  }

  return { released: mine.reduce((n, p) => n + Number(p.amount), 0), error: null };
}

/**
 * 새로 만든 청구서에 **남은 예치금을 저절로 붙입니다**(일괄 발행처럼 사람이 고르지 않는 자리).
 *
 * 먼저 받아둔 돈이 있는데 청구서가 「미납」으로 뜨면, 이미 낸 학부모에게 독촉이 나갑니다.
 * 다만 사람이 안 본 자리이므로 **통째로 들어가는 항목만** 덮습니다(`firstFitLines`). 무엇을
 * 뺄지 바꾸려면 금전 창 · 결제 창의 「예치금에서 빼기」에서 다시 고릅니다.
 */
export async function applyPrepaid(
  supabase: SupabaseClient,
  invoice: { id: string; invoice_no: string; student_id: string | null; total_amount: number },
  actor: string,
): Promise<{ applied: number; error: string | null }> {
  if (!invoice.student_id || invoice.total_amount <= 0) return { applied: 0, error: null };

  const dep = await loadDeposits(supabase, invoice.student_id);
  if (dep.error) return { applied: 0, error: dep.error };
  if (dep.balance <= 0) return { applied: 0, error: null };

  const { data, error } = await supabase
    .from("invoice_lines")
    .select("id, name, amount, paid_payment_id")
    .eq("invoice_id", invoice.id)
    .order("seq");
  if (error) return { applied: 0, error: `청구 항목을 읽지 못해 예치금을 붙이지 않았습니다: ${error.message}` };
  // 할인 줄은 그 위 항목에 붙여 한 덩어리로 셉니다(`groupLines`).
  const open = groupLines(((data as { id: string; name: string; amount: number | string; paid_payment_id: string | null }[] | null) ?? []).map((l) => ({ ...l, amount: Number(l.amount) })))
    .filter((i) => !i.paid)
    .map((i) => ({ id: i.id, amount: i.amount, members: i.members }));

  const pick = new Set(firstFitLines(dep.balance, open));
  if (pick.size === 0) return { applied: 0, error: null };
  const r = await applyDepositToLines(supabase, invoice, open.filter((l) => pick.has(l.id)), actor, "선입금 자동충당");
  return { applied: r.applied, error: r.error };
}
