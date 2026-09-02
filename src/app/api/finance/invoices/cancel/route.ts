import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

// 인보이스 취소.
//
// **지우지 않습니다.** 상태를 `취소` 로 바꾸고 누가·언제·왜 취소했는지를 남깁니다. 지워버리면
// 나중에 "그 청구서 어디 갔냐"는 물음에 답할 방법이 없고, 번호도 비어 버립니다.
//
// 취소한 뒤에는 항목을 고쳐 **다시 발행**할 수 있습니다. 새 번호가 붙습니다 - 같은 번호를
// 다시 쓰면 학부모가 받은 두 장이 같은 번호가 됩니다.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = body?.invoiceId as string | undefined;
  const reason = String(body?.reason ?? "").trim();
  const force = !!body?.force;
  if (!id) return NextResponse.json({ error: "invoiceId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();

  const { data: inv, error: invErr } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "청구서를 찾지 못했습니다." }, { status: 404 });
  if (inv.status === "취소") return NextResponse.json({ error: "이미 취소된 청구서입니다." }, { status: 400 });

  // 이미 받은 돈이 붙어 있으면 그냥 취소하면 안 됩니다. 그 입금이 어디에도 안 붙은 채로
  // 남아, 나중에 장부가 안 맞습니다. 수납을 먼저 정리하도록 알려줍니다.
  const { data: pays, error: payErr } = await supabase.from("payments").select("id, amount").eq("invoice_id", id);
  if (payErr) console.error("[인보이스 취소] 수납을 읽지 못했습니다:", payErr.message);
  const paid = (pays ?? []).reduce((n, p) => n + Number(p.amount), 0);
  if (paid > 0 && !force) {
    return NextResponse.json(
      {
        error: `이 청구서에는 이미 받은 돈 ${paid.toLocaleString("ko-KR")}원이 붙어 있습니다. 수납 탭에서 그 입금을 먼저 옮기거나 지운 뒤에 취소해주세요.`,
        paid,
        needsForce: true,
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("invoices")
    .update({
      status: "취소",
      cancel_reason: reason || null,
      cancelled_at: new Date().toISOString(),
      cancelled_by: me.name || me.email,
    })
    .eq("id", id)
    .eq("status", "발행")
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "취소하지 못했습니다." }, { status: 500 });

  return NextResponse.json({ ok: true, invoice: data });
}
