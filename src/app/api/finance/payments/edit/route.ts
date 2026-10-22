import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { PAYMENT_METHOD_KINDS, needsCashReceipt } from "@/lib/payments";

/**
 * **받은 돈 한 줄의 수단·수납일·메모 고치기.**
 *
 * 고칠 길이 없을 때 사람은 지울 길을 찾습니다. 수단을 잘못 고른 수납을 고치려고 청구서 발행을
 * 취소했고, 취소는 받은 돈을 예치금으로 떼어내므로 멀쩡한 청구서 두 장이 취소되고 돈은 예치금에
 * 떴습니다. 틀린 것이 수단 하나라면 그 칸 하나만 고치면 됩니다.
 *
 * **금액은 고치지 않습니다.** 금액이 바뀌면 청구서 잔액·항목 표시·예치금이 함께 움직여야 해서,
 * 그 일은 되돌리기와 다시 받기로 합니다.
 *
 * 무엇을 언제 누가 바꿨는지 메모 끝에 남깁니다 - 월말에 수단별 합계가 지난주와 다르면 이유가
 * 그 줄에 적혀 있어야 합니다. 마감한 달의 줄은 데이터베이스가 막습니다(trg_block_closed_month_payment).
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.paymentId === "string" ? body.paymentId : "";
  if (!id) return NextResponse.json({ error: "고칠 수납을 골라주세요." }, { status: 400 });

  const method = body?.method == null ? null : String(body.method);
  if (method !== null && !(PAYMENT_METHOD_KINDS as readonly string[]).includes(method)) {
    return NextResponse.json({ error: `결제 수단을 골라주세요(${PAYMENT_METHOD_KINDS.join(" · ")}).` }, { status: 400 });
  }
  const paidAt = body?.paidAt == null ? null : String(body.paidAt);
  if (paidAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    return NextResponse.json({ error: "수납일 형식이 맞지 않습니다." }, { status: 400 });
  }
  if (paidAt !== null && paidAt > todayKst()) {
    return NextResponse.json({ error: "수납일이 오늘보다 뒤입니다." }, { status: 400 });
  }
  const memo = body?.memo == null ? null : String(body.memo).slice(0, 500);

  const supabase = await createClient();
  const { data: cur, error: readErr } = await supabase
    .from("payments")
    .select("id, amount, paid_at, method, method_kind, memo, kind")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: `수납을 읽지 못했습니다: ${readErr.message}` }, { status: 500 });
  if (!cur) return NextResponse.json({ error: "그 수납을 찾지 못했습니다." }, { status: 404 });
  if ((cur.kind ?? "") === "refund") {
    return NextResponse.json({ error: "돌려준 돈은 여기서 고치지 않습니다. 환불 결재에서 다뤄주세요." }, { status: 400 });
  }

  const oldKind = (cur.method_kind as string | null) ?? (cur.method as string | null) ?? "";
  const changes: string[] = [];
  const patch: Record<string, unknown> = {};
  if (method !== null && method !== oldKind) {
    patch.method = method;
    patch.method_kind = method;
    changes.push(`수단 ${oldKind || "없음"}→${method}`);
  }
  if (paidAt !== null && paidAt !== cur.paid_at) {
    patch.paid_at = paidAt;
    changes.push(`수납일 ${cur.paid_at}→${paidAt}`);
  }
  const baseMemo = memo !== null ? memo.trim() : ((cur.memo as string | null) ?? "");
  if (memo !== null && memo.trim() !== ((cur.memo as string | null) ?? "")) changes.push("메모");
  if (changes.length === 0) return NextResponse.json({ ok: true, changed: [] });

  const stamp = `${changes.filter((c) => c !== "메모").join(", ")}`;
  patch.memo = stamp ? `${baseMemo}${baseMemo ? " · " : ""}${stamp}(${todayKst()} ${me.name || me.email})` : baseMemo || null;

  const { error } = await supabase.from("payments").update(patch).eq("id", id);
  if (error) {
    const closed = /마감/.test(error.message);
    return NextResponse.json(
      // 마감 문지기의 글은 이미 «어디서 열면 되는지»까지 말합니다. 그대로 보여줍니다.
      { error: closed ? error.message : `고치지 못했습니다: ${error.message}` },
      { status: closed ? 409 : 500 },
    );
  }

  // 현금영수증 대상이 바뀌었으면 알려줍니다. 저절로 만들거나 지우지 않습니다 - 이미 단말기에서
  // 발행했을 수 있고, 그건 국세청 쪽 일이라 사람이 확인해야 합니다.
  const nextKind = method ?? oldKind;
  const receiptNote =
    method !== null && needsCashReceipt(oldKind) !== needsCashReceipt(nextKind)
      ? needsCashReceipt(nextKind)
        ? "현금영수증 대상 수단으로 바뀌었습니다. 필요하면 현금영수증 화면에서 신청을 넣어주세요."
        : "현금영수증 대상이 아닌 수단으로 바뀌었습니다. 이 수납으로 넣어 둔 현금영수증 신청이 있으면 현금영수증 화면에서 확인해주세요."
      : null;

  return NextResponse.json({ ok: true, changed: changes, receiptNote });
}
