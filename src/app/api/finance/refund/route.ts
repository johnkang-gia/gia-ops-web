import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";

export const dynamic = "force-dynamic";

/**
 * **돌려드린 돈을 적습니다.**
 *
 * ── 왜 지우지 않나 ──────────────────────────────────────────────────────────
 *
 * 환불할 곳이 없으면 사람은 **원래 입금 줄을 지웁니다.** 그러면 그날 수납 집계가 바뀌고,
 * 이미 보고한 숫자와 달라집니다. 그리고 왜 달라졌는지 되짚을 곳이 없습니다.
 *
 * 원래 기록은 그대로 두고 **반대 방향 한 줄을 더합니다.** 잔액은 `청구액 − sum(입금)` 이라
 * (`settlement.ts`) 음수 한 줄이 들어가면 잔액·월별 집계·거래명세서가 손댈 것 없이 맞습니다.
 *
 * ── 얼마까지 돌려줄 수 있나 ─────────────────────────────────────────────────
 *
 * **받은 것보다 많이 돌려줄 수는 없습니다.** 그 청구서에 들어온 돈의 합이 상한입니다.
 * 넘겨서 넣으면 잔액이 청구액보다 커지고, 그 청구서는 영영 이상한 상태로 남습니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { invoiceId?: string; amount?: number; reason?: string; refundedAt?: string; method?: string }
    | null;

  const invoiceId = body?.invoiceId;
  const reason = String(body?.reason ?? "").trim();
  const asked = Math.round(Number(body?.amount));
  if (!invoiceId) return NextResponse.json({ error: "청구서를 골라주세요." }, { status: 400 });
  // **이유 없이는 못 돌려줍니다.** 되돌릴 수 없는 일이라, 이유가 안 남으면 나중에 설명할
  // 방법이 없습니다. 데이터베이스도 같은 검사를 겁니다.
  if (!reason) return NextResponse.json({ error: "환불 사유를 적어주세요." }, { status: 400 });
  if (!Number.isFinite(asked) || asked <= 0) {
    return NextResponse.json({ error: "돌려줄 금액을 적어주세요." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, student_name, student_name_ko, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "청구서를 찾지 못했습니다." }, { status: 404 });

  // 받은 돈의 합(이미 돌려준 것을 뺀 값). 음수 줄이 함께 더해지므로 그대로 상한이 됩니다.
  const { data: pays, error: payErr } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId);
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });
  const held = (pays ?? []).reduce((n, p) => n + Number((p as { amount: number | string }).amount), 0);
  if (asked > held) {
    return NextResponse.json(
      { error: `이 청구서로 받은 돈은 ${held.toLocaleString("ko-KR")}원입니다. 그보다 많이 돌려줄 수 없습니다.` },
      { status: 400 },
    );
  }

  const refundedAt =
    body?.refundedAt && /^\d{4}-\d{2}-\d{2}$/.test(body.refundedAt) ? body.refundedAt : todayKst();

  const { data: made, error } = await supabase
    .from("payments")
    .insert({
      invoice_id: invoiceId,
      student_id: inv.student_id,
      paid_at: refundedAt,
      // **음수로 넣습니다.** 종류와 부호는 데이터베이스가 짝을 검사합니다.
      amount: -asked,
      kind: "환불",
      refund_reason: reason,
      method: (body?.method ?? "").trim() || "계좌이체",
      method_kind: (body?.method ?? "").trim() || "계좌이체",
      payer_name: (inv.student_name_ko as string | null) ?? (inv.student_name as string),
      memo: `환불 · ${reason}`,
      source: "환불",
      origin: "환불",
      matched_by: me.email,
      created_by: me.email,
    })
    .select()
    .single();

  if (error) {
    // 마감된 달이면 데이터베이스가 막습니다. 그 말을 그대로 전합니다 - 「저장 실패」로만
    // 적으면 담당자는 무엇을 해야 하는지 모릅니다.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, payment: made, refunded: asked });
}
