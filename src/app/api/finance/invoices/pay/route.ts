import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { PAYMENT_METHOD_KINDS } from "@/lib/payments";
import { settle, type SettleInvoice, type SettlePayment } from "@/lib/settlement";

/**
 * 청구서 한 장에 **결제완료 체크**.
 *
 * 지금까지 입금은 수납 화면에서 따로 넣어야 했습니다. 그래서 「보냈다」와 「받았다」가 두
 * 화면에 갈려 있었고, 청구서 목록만 보고는 누가 냈는지 알 수 없었습니다.
 *
 * 여기서는 청구서를 보는 그 자리에서 체크합니다. 체크 한 번이 `payments` 한 줄입니다 -
 * 새 표를 만들지 않습니다. 상태 칸도 만들지 않습니다. **잔액과 상태는 늘 계산으로 냅니다.**
 *
 * 수단(현금·방문카드·계좌이체·올톡페이)은 **반드시 고르게 합니다.** 자유 글자로 두면
 * 「현금」·「현금납부」·「cash」가 섞이고, 그러면 월말에 세는 일이 다시 사람 손으로 돌아갑니다.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const invoiceId = String(body?.invoiceId ?? "");
  const action = String(body?.action ?? "pay");
  if (!invoiceId) return NextResponse.json({ error: "invoiceId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, student_name, student_name_ko, issue_date, due_date, total_amount, status, category, stream, carried_to_invoice_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "청구서를 찾지 못했습니다." }, { status: 404 });

  const { data: pays, error: payErr } = await supabase
    .from("payments")
    .select("id, invoice_id, amount, source")
    .eq("invoice_id", invoiceId);
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  // ── 체크 해제 ─────────────────────────────────────────────────────────────
  //
  // 잘못 눌렀을 때 되돌릴 길이 없으면 사람은 아예 안 누릅니다. 다만 **이 화면에서 넣은
  // 줄만** 지웁니다 - 통장 엑셀로 들어온 입금까지 여기서 지우면 대사한 결과가 사라집니다.
  if (action === "unpay") {
    const mine = (pays ?? []).filter((p) => p.source === "완납체크");
    if (mine.length === 0) {
      return NextResponse.json(
        { error: "이 청구서의 입금은 수납 화면에서 넣은 것이라 여기서 지울 수 없습니다. 수납에서 지워주세요." },
        { status: 400 },
      );
    }
    const { error } = await supabase.from("payments").delete().in("id", mine.map((p) => p.id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: mine.length });
  }

  // ── 결제완료 ──────────────────────────────────────────────────────────────
  const method = String(body?.method ?? "");
  if (!(PAYMENT_METHOD_KINDS as readonly string[]).includes(method)) {
    return NextResponse.json({ error: `납부 수단을 골라주세요(${PAYMENT_METHOD_KINDS.join(" · ")}).` }, { status: 400 });
  }
  const today = todayKst();
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.paidAt ?? "")) ? String(body.paidAt) : today;

  const s = settle(inv as SettleInvoice, (pays ?? []) as SettlePayment[], today);
  if (s.state === "취소") return NextResponse.json({ error: "취소된 청구서입니다." }, { status: 400 });
  if (s.state === "이월됨") {
    return NextResponse.json({ error: "이미 다음 청구서로 이월된 건입니다. 이월된 청구서에서 받으세요." }, { status: 400 });
  }

  // 항목을 골라 받는 경우. 「7만원 남았습니다」가 아니라 「교복값이 남았습니다」라고 말할
  // 수 있어야 합니다 - 금액만 말하면 학부모가 무슨 돈인지 되묻고, 그 통화가 일이 됩니다.
  const lineIds = Array.isArray(body?.lineIds) ? (body.lineIds as string[]).filter((x) => typeof x === "string") : [];
  let lineTotal = 0;
  if (lineIds.length > 0) {
    const { data: lines, error: lineErr } = await supabase
      .from("invoice_lines")
      .select("id, amount, paid_payment_id")
      .eq("invoice_id", inv.id)
      .in("id", lineIds);
    if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 });
    const rows = lines ?? [];
    if (rows.length !== lineIds.length) {
      return NextResponse.json({ error: "고른 항목 중 이 청구서에 없는 것이 있습니다." }, { status: 400 });
    }
    const already = rows.filter((r) => r.paid_payment_id);
    if (already.length > 0) {
      return NextResponse.json({ error: `이미 받은 항목이 섞여 있습니다(${already.length}건).` }, { status: 400 });
    }
    lineTotal = rows.reduce((n, r) => n + Math.round(Number(r.amount)), 0);
  }

  // 금액을 안 적으면 남은 만큼. 항목을 골랐으면 그 합계가 곧 금액입니다.
  const asked = Number(body?.amount);
  const amount = lineIds.length > 0 ? lineTotal : Number.isFinite(asked) && asked > 0 ? Math.round(asked) : s.balance;
  if (amount <= 0) return NextResponse.json({ error: "이미 완납된 청구서입니다." }, { status: 400 });
  if (amount > s.balance) {
    return NextResponse.json({ error: `남은 금액(${s.balance.toLocaleString()}원)보다 많습니다.` }, { status: 400 });
  }

  const { data: made, error } = await supabase.from("payments").insert({
    invoice_id: inv.id,
    student_id: inv.student_id,
    paid_at: paidAt,
    amount,
    method,
    method_kind: method,
    payer_name: (inv.student_name_ko as string | null) ?? (inv.student_name as string),
    memo: (body?.memo as string | null) ?? null,
    // 어디서 들어온 줄인지. 이 표시가 있어야 체크 해제로 지울 것과 통장 대사로 붙은 것을 가릅니다.
    source: "완납체크",
    matched_by: me.email,
    created_by: me.email,
  }).select("id").single();
  if (error || !made) return NextResponse.json({ error: error?.message ?? "저장 실패" }, { status: 500 });

  // 어느 항목을 덮었는지 표시합니다. 실패를 삼키지 않습니다 - 돈은 들어갔는데 항목이
  // 안 붙으면 「무엇이 남았나」가 영영 틀립니다.
  if (lineIds.length > 0) {
    const { error: markErr } = await supabase
      .from("invoice_lines")
      .update({ paid_payment_id: made.id })
      .in("id", lineIds)
      .is("paid_payment_id", null);
    if (markErr) {
      return NextResponse.json(
        { error: `입금은 넣었지만 어느 항목인지 표시하지 못했습니다(${markErr.message}). 항목별 남은 금액이 틀릴 수 있습니다.` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, amount, balance: s.balance - amount });
}
