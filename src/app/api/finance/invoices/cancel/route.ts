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
// 「이미 받음」이 함께 만든 입금은 **함께 지웁니다** - 그 줄은 발행이 만든 것이라, 발행을
// 없던 일로 하면 함께 없던 일이 됩니다. 수납 화면에서 사람이 따로 붙인 입금만 선입금으로
// 떼어냅니다.

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
  // 취소는 **발행을 없던 일로 만드는 것**입니다. 금액이 틀렸거나 항목을 빠뜨렸을 때 눌러서
  // 발행 전 상태로 돌린 뒤 다시 발행합니다.
  //
  // 그래서 입금을 두 갈래로 가릅니다.
  //
  // **① 「이미 받음」이 만든 입금**(`matched_by = '이미받음'`) - 이 줄은 발행이 만든 것입니다.
  //    사람이 수납 화면에서 따로 넣은 것이 아니라, 청구서를 만드는 그 동작에 딸려 들어왔습니다.
  //    발행을 없던 일로 하면 이 줄도 함께 없던 일이 됩니다. 남겨두면 선입금이 하나 떠서,
  //    고쳐서 다시 발행할 때 금액이 저절로 깎입니다 - 담당자가 기대하는 것과 다릅니다.
  //
  // **② 그 밖의 입금** - 수납 화면에서 사람이 붙인 진짜 입금입니다. 발행이 만든 것이 아니므로
  //    발행을 되돌린다고 지울 수 없습니다. 지우지도 매달아 두지도 않고 **선입금으로 떼어내**
  //    (`invoice_id = null`) 다음 청구서에 충당되게 둡니다.
  const { data: pays, error: payErr } = await supabase
    .from("payments")
    .select("id, amount, matched_by")
    .eq("invoice_id", id);
  // 읽지 못했으면 취소를 **하지 않습니다.** 붙은 돈이 있는지 모르는 채로 취소하면, 그 돈이
  // 취소된 청구서에 매달린 채 남습니다 - 화면에는 아무 표시도 안 납니다.
  if (payErr) {
    return NextResponse.json(
      { error: `이 청구서에 붙은 입금을 읽지 못해 취소하지 않았습니다: ${payErr.message}` },
      { status: 500 },
    );
  }

  type PayRow = { id: string; amount: number | string; matched_by: string | null };
  const rows = (pays as PayRow[] | null) ?? [];
  const fromIssue = rows.filter((p) => p.matched_by === "이미받음");
  const fromDesk = rows.filter((p) => p.matched_by !== "이미받음");
  const deskPaid = fromDesk.reduce((n, p) => n + Number(p.amount), 0);

  // 되묻는 것은 **사람이 따로 넣은 입금**이 있을 때뿐입니다. 「이미 받음」으로 만든 줄까지
  // 매번 물으면, 가장 흔한 경우(금액 고쳐 다시 발행)에 확인 창이 하나 더 끼어듭니다.
  if (deskPaid > 0 && !force) {
    return NextResponse.json(
      {
        error: `이 청구서에는 수납 화면에서 붙인 입금 ${deskPaid.toLocaleString("ko-KR")}원이 있습니다. 취소하면 그 돈은 선입금으로 남아 다음 청구서에 저절로 충당됩니다.`,
        paid: deskPaid,
        needsForce: true,
      },
      { status: 409 },
    );
  }

  // **입금부터 정리합니다.** 취소부터 하고 여기서 실패하면, 취소된 청구서에 돈이 매달린 채로
  // 남습니다. 순서를 이렇게 두면 최악이라도 「멀쩡한 청구서에서 입금만 정리된」 상태가 되는데,
  // 그건 화면에서 눈에 띄고 되돌릴 수 있습니다.
  let removed = 0;
  if (fromIssue.length > 0) {
    const { error: delErr } = await supabase
      .from("payments")
      .delete()
      .in("id", fromIssue.map((p) => p.id));
    if (delErr) {
      return NextResponse.json(
        { error: `「이미 받음」으로 넣은 입금을 지우지 못해 취소하지 않았습니다: ${delErr.message}` },
        { status: 500 },
      );
    }
    removed = fromIssue.reduce((n, p) => n + Number(p.amount), 0);
  }

  let detached = 0;
  if (fromDesk.length > 0) {
    const { error: cutErr } = await supabase
      .from("payments")
      .update({ invoice_id: null, matched_by: "청구 취소로 떼어냄" })
      .in("id", fromDesk.map((p) => p.id));
    if (cutErr) {
      return NextResponse.json(
        { error: `받은 돈을 선입금으로 떼어내지 못해 취소하지 않았습니다: ${cutErr.message}` },
        { status: 500 },
      );
    }
    detached = deskPaid;
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

  return NextResponse.json({ ok: true, invoice: data, detached, removed });
}
