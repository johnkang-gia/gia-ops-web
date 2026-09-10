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
//
// 붙어 있던 입금은 지우지 않고 **선입금으로 떼어냅니다.** 「이미 받음」으로 만든 청구서를
// 취소하는 일이 흔한데, 그 돈은 실제로 받은 돈이라 함께 지우면 장부에서 사라집니다.

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

  // ── 붙어 있는 입금 ─────────────────────────────────────────────────────────
  //
  // 그 돈은 **실제로 받은 돈**입니다. 청구서를 취소한다고 없던 일이 되지 않습니다. 그렇다고
  // 취소된 청구서에 붙여 두면 장부가 안 맞습니다 - 「취소된 청구서에 낸 돈」은 어느 칸에도
  // 안 세어집니다.
  //
  // 그래서 지우지도, 붙여 두지도 않고 **선입금으로 떼어냅니다**(`invoice_id = null`). 그
  // 학생의 다음 청구서를 만들 때 `applyPrepaid` 가 저절로 충당합니다.
  const { data: pays, error: payErr } = await supabase.from("payments").select("id, amount").eq("invoice_id", id);
  // 읽지 못했으면 취소를 **하지 않습니다.** 붙은 돈이 있는지 모르는 채로 취소하면, 그 돈이
  // 취소된 청구서에 매달린 채 남습니다 - 화면에는 아무 표시도 안 납니다.
  if (payErr) {
    return NextResponse.json(
      { error: `이 청구서에 붙은 입금을 읽지 못해 취소하지 않았습니다: ${payErr.message}` },
      { status: 500 },
    );
  }
  const paid = (pays ?? []).reduce((n, p) => n + Number(p.amount), 0);
  if (paid > 0 && !force) {
    return NextResponse.json(
      {
        error: `이 청구서에는 이미 받은 돈 ${paid.toLocaleString("ko-KR")}원이 붙어 있습니다. 취소하면 그 돈은 선입금으로 남아 다음 청구서에 저절로 충당됩니다.`,
        paid,
        needsForce: true,
      },
      { status: 409 },
    );
  }

  // **떼어내기가 먼저입니다.** 취소부터 하고 떼어내다 실패하면, 취소된 청구서에 돈이 매달린
  // 채로 남습니다. 순서를 이렇게 두면 최악이라도 「멀쩡한 청구서에 돈이 선입금으로 떠 있는」
  // 상태가 되는데, 그건 화면에서 눈에 띄고 되돌릴 수 있습니다.
  let detached = 0;
  if (paid > 0) {
    const { error: cutErr } = await supabase
      .from("payments")
      .update({ invoice_id: null, matched_by: "청구 취소로 떼어냄" })
      .eq("invoice_id", id);
    if (cutErr) {
      return NextResponse.json(
        { error: `받은 돈을 선입금으로 떼어내지 못해 취소하지 않았습니다: ${cutErr.message}` },
        { status: 500 },
      );
    }
    detached = paid;
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

  return NextResponse.json({ ok: true, invoice: data, detached });
}
