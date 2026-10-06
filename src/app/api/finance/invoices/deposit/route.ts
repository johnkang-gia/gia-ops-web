import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { settle, type SettleInvoice, type SettlePayment } from "@/lib/settlement";
import { applyDepositToLines, loadDeposits, releaseDeposit } from "@/lib/prepaidApply";
import { DEPOSIT_PICKED, isFromDeposit, groupLines } from "@/lib/depositLines";

/**
 * **예치금에서 뺄 항목을 정합니다.** 고른 항목이 곧 이 청구서의 예치금 차감 전부입니다.
 *
 * 「더하기」가 아니라 「이렇게 맞추기」로 받습니다. 이미 뺀 것을 바꾸려면 빼고 다시 넣어야
 * 하는데, 그걸 화면이 두 번에 나눠 부르면 가운데서 끊겼을 때 반만 바뀐 채 남습니다. 그래서
 * 이 청구서에 붙은 예치금을 먼저 예치금으로 되돌리고, 고른 항목을 고른 순서대로 다시 덮습니다.
 * 돈은 한 원도 지우지 않습니다 - 청구서와 예치금 사이를 오갈 뿐입니다.
 *
 * 빈 목록이면 되돌리기만 합니다.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { invoiceId?: string; lineIds?: unknown; allowPartial?: boolean };
  const invoiceId = String(body.invoiceId ?? "");
  if (!invoiceId) return NextResponse.json({ error: "invoiceId가 필요합니다." }, { status: 400 });
  const lineIds = Array.isArray(body.lineIds) ? body.lineIds.filter((x): x is string => typeof x === "string") : [];

  const supabase = await createClient();
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, issue_date, due_date, total_amount, status, carried_to_invoice_id, written_off_amount")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "청구서를 찾지 못했습니다." }, { status: 404 });
  if (!inv.student_id) return NextResponse.json({ error: "학생이 이어지지 않은 청구서입니다." }, { status: 400 });

  const [linesRes, paysRes, dep] = await Promise.all([
    supabase.from("invoice_lines").select("id, name, amount, paid_payment_id").eq("invoice_id", invoiceId).order("seq"),
    supabase.from("payments").select("id, invoice_id, amount, source, matched_by").eq("invoice_id", invoiceId),
    loadDeposits(supabase, inv.student_id as string),
  ]);
  if (linesRes.error) return NextResponse.json({ error: linesRes.error.message }, { status: 500 });
  if (paysRes.error) return NextResponse.json({ error: paysRes.error.message }, { status: 500 });
  if (dep.error) return NextResponse.json({ error: dep.error }, { status: 500 });

  const s = settle(inv as SettleInvoice, (paysRes.data ?? []) as SettlePayment[], todayKst());
  if (s.state === "취소") return NextResponse.json({ error: "취소된 청구서입니다." }, { status: 400 });
  if (s.state === "이월됨") return NextResponse.json({ error: "다음 청구서로 이월된 건입니다. 이월된 청구서에서 빼주세요." }, { status: 400 });

  type Pay = { id: string; amount: number | string; matched_by: string | null };
  const pays = (paysRes.data as Pay[] | null) ?? [];
  const depIds = new Set(pays.filter((p) => isFromDeposit(p.matched_by)).map((p) => p.id));
  const onInvoiceFromDeposit = pays.filter((p) => depIds.has(p.id)).reduce((n, p) => n + Number(p.amount), 0);
  const otherPaid = pays.filter((p) => !depIds.has(p.id)).reduce((n, p) => n + Number(p.amount), 0);

  // 되돌린 뒤의 모습으로 셉니다. 지금 붙은 예치금은 돌아오고, 다른 돈으로 받은 항목은 그대로입니다.
  type Line = { id: string; name: string; amount: number | string; paid_payment_id: string | null };
  const lines = (linesRes.data as Line[] | null) ?? [];
  const lineById = new Map(lines.map((l) => [l.id, l]));
  // 할인 줄은 그 위 항목과 한 덩어리입니다. 고르는 단위도, 빼는 금액도 덩어리입니다.
  const items = groupLines(lines.map((l) => ({ ...l, amount: Number(l.amount) })));
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = lineIds.filter((id) => !byId.has(id));
  if (missing.length > 0) return NextResponse.json({ error: "고른 항목 중 이 청구서에 없는 것이 있습니다." }, { status: 400 });
  const paidElsewhere = lineIds.filter((id) =>
    byId.get(id)!.members.some((m) => {
      const p = lineById.get(m)?.paid_payment_id;
      return p && !depIds.has(p);
    }),
  );
  if (paidElsewhere.length > 0) {
    return NextResponse.json(
      { error: `이미 다른 돈으로 받은 항목이 섞여 있습니다: ${paidElsewhere.map((id) => byId.get(id)!.name).join(", ")}` },
      { status: 400 },
    );
  }

  const chosen = lineIds.map((id) => ({ id, amount: byId.get(id)!.amount, members: byId.get(id)!.members })).filter((l) => l.amount > 0);
  const need = chosen.reduce((n, l) => n + l.amount, 0);
  const available = dep.balance + onInvoiceFromDeposit;
  // 다른 돈으로 이미 받은 몫까지 예치금에서 또 빼면 그 청구서는 과납이 됩니다.
  const room = Math.max(0, Number(inv.total_amount) - otherPaid);
  if (need > room) {
    return NextResponse.json(
      { error: `이 청구서에서 아직 안 받은 금액(${room.toLocaleString()}원)보다 많이 고르셨습니다. 다른 돈으로 받은 몫이 있습니다.` },
      { status: 400 },
    );
  }
  // 모자라면 **먼저 알리고 멈춥니다.** 마지막 항목을 일부만 덮을지는 사람이 정합니다 - 종이에
  // 「교복 중 일부」가 찍히는 일이라, 아무도 안 본 채로 그렇게 나가면 안 됩니다.
  if (need > available && body.allowPartial !== true) {
    return NextResponse.json(
      { error: `예치금(${available.toLocaleString()}원)이 고른 항목(${need.toLocaleString()}원)보다 적습니다.`, available, need },
      { status: 409 },
    );
  }

  const rel = await releaseDeposit(supabase, invoiceId);
  if (rel.error) return NextResponse.json({ error: rel.error }, { status: 500 });

  const r = await applyDepositToLines(
    supabase,
    { id: inv.id as string, invoice_no: inv.invoice_no as string, student_id: inv.student_id as string },
    chosen,
    me.email,
    `${DEPOSIT_PICKED} · ${me.name || me.email}`,
  );
  // 되돌리기는 됐는데 붙이기가 실패하면, 돈은 예치금에 그대로 있습니다(사라지지 않음).
  // 그 사실을 그대로 말합니다.
  if (r.error) {
    return NextResponse.json(
      { error: `${r.error} — 이 청구서에 붙어 있던 예치금 ${rel.released.toLocaleString()}원은 예치금으로 돌아가 있습니다.` },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    released: rel.released,
    applied: r.applied,
    left: r.left,
    partial: r.partial ? { ...r.partial, name: byId.get(r.partial.lineId)?.name ?? "" } : null,
  });
}
