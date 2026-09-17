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
    // **출처(`origin`)로 가릅니다.** `matched_by` 는 선입금 충당이 덮어쓰므로, 한 번이라도
    // 충당을 거친 「이미 받음」 입금은 그 이름을 잃습니다. 그러면 취소가 못 알아보고 그 돈이
    // 선입금으로 살아남아, 다음 청구서에 저절로 얹힙니다(20261026 마이그레이션).
    .select("id, amount, matched_by, origin")
    .eq("invoice_id", id);
  // 읽지 못했으면 취소를 **하지 않습니다.** 붙은 돈이 있는지 모르는 채로 취소하면, 그 돈이
  // 취소된 청구서에 매달린 채 남습니다 - 화면에는 아무 표시도 안 납니다.
  if (payErr) {
    return NextResponse.json(
      { error: `이 청구서에 붙은 입금을 읽지 못해 취소하지 않았습니다: ${payErr.message}` },
      { status: 500 },
    );
  }

  type PayRow = { id: string; amount: number | string; matched_by: string | null; origin: string | null };
  const rows = (pays as PayRow[] | null) ?? [];

  // ③ **발행이 끌어다 붙인 선입금**(`선입금 자동충당`).
  //
  // 이 돈은 발행 **전부터** 선입금으로 있던 것을 발행이 가져다 붙인 것입니다. 취소하면 원래
  // 있던 자리로 돌아갈 뿐이라, 새로 생기는 것이 없습니다.
  //
  // 앞 판은 이것을 ②(사람이 붙인 입금)와 같이 취급해서 **매번 「선입금으로 남습니다」라고
  // 물었습니다.** 취소는 되돌리기인데 되돌릴 때마다 못 보던 경고가 뜨니, 담당자는 뭔가
  // 잘못됐다고 읽게 됩니다. 원래 자리로 돌아가는 것은 물을 일이 아닙니다.
  // 출처가 「이미받음」이면 **충당을 거쳤든 아니든** 발행이 만든 돈입니다. 옛 줄은 출처가
  // 비어 있을 수 있어 예전 기준(`matched_by`)도 함께 봅니다.
  const madeByIssue = (p: PayRow) => p.origin === "이미받음" || (!p.origin && p.matched_by === "이미받음");
  const fromIssue = rows.filter(madeByIssue);
  const fromPrepaid = rows.filter((p) => !madeByIssue(p) && p.matched_by === "선입금 자동충당");
  const fromDesk = rows.filter((p) => !madeByIssue(p) && p.matched_by !== "선입금 자동충당");
  const deskPaid = fromDesk.reduce((n, p) => n + Number(p.amount), 0);
  const prepaidBack = fromPrepaid.reduce((n, p) => n + Number(p.amount), 0);

  // 되묻는 것은 **사람이 따로 넣은 입금**이 있을 때뿐입니다. 「이미 받음」으로 만든 줄과
  // 원래 선입금이던 줄까지 매번 물으면, 가장 흔한 경우(금액 고쳐 다시 발행)에 확인 창이
  // 하나 더 끼어듭니다.
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

  // 끌어다 붙였던 선입금은 **원래대로** 떼어냅니다. 출처 이름을 그대로 둡니다 - 예전에는
  // 「청구 취소로 떼어냄」으로 덮어써서, 그 줄이 원래 무엇이었는지가 사라졌습니다.
  let returned = 0;
  if (fromPrepaid.length > 0) {
    const { error: backErr } = await supabase
      .from("payments")
      .update({ invoice_id: null })
      .in("id", fromPrepaid.map((p) => p.id));
    if (backErr) {
      return NextResponse.json(
        { error: `충당했던 선입금을 되돌리지 못해 취소하지 않았습니다: ${backErr.message}` },
        { status: 500 },
      );
    }
    returned = prepaidBack;
  }

  let detached = 0;
  if (fromDesk.length > 0) {
    // 원래 출처를 지우지 않고 **덧붙입니다.** 「수기 · 청구 취소로 떼어냄」처럼 남겨야
    // 선입금 화면에서 이 돈이 어디서 왔는지 읽을 수 있습니다.
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

  // ── 현금영수증도 함께 내립니다 ──────────────────────────────────────────
  //
  // 청구서를 취소하면 그 청구서에 붙은 현금영수증 **신청**은 더 이상 발행할 것이 없습니다.
  // 그런데 지금까지는 그대로 남았습니다 - 청구 화면에서는 안 보이고 현금영수증 화면에는
  // 그대로 떠서, 두 화면의 숫자가 달랐습니다. 담당자는 없는 청구서의 영수증을 발행하려고
  // 단말기 앞에 섭니다.
  //
  // **이미 발행된 것은 건드리지 않습니다.** 종이가 이미 나갔고 국세청에도 올라갔으므로,
  // 앱에서 상태만 바꾼다고 없던 일이 되지 않습니다. 그건 취소 신고를 따로 해야 하는 일이라
  // 사람이 알아야 합니다 - 숫자로 돌려주고 화면이 적습니다.
  let receiptsCancelled = 0;
  let receiptsIssued = 0;
  {
    const { data: rs } = await supabase.from("cash_receipts").select("id, status").eq("invoice_id", id);
    const list = ((rs as { id: string; status: string }[] | null) ?? []);
    receiptsIssued = list.filter((r) => r.status === "발행").length;
    const pending = list.filter((r) => r.status === "신청").map((r) => r.id);
    if (pending.length > 0) {
      const { error: crErr } = await supabase.from("cash_receipts").update({ status: "취소" }).in("id", pending);
      if (crErr) {
        return NextResponse.json(
          { error: `현금영수증 신청을 내리지 못해 취소하지 않았습니다: ${crErr.message}` },
          { status: 500 },
        );
      }
      receiptsCancelled = pending.length;
    }
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

  return NextResponse.json({
    ok: true,
    invoice: data,
    detached,
    removed,
    returned,
    receiptsCancelled,
    receiptsIssued,
    // 이미 발행된 영수증은 앱이 없앨 수 없습니다. 그 사실을 문장으로 돌려줍니다 -
    // 숫자만 주면 화면마다 다르게 해석합니다.
    receiptNote:
      receiptsIssued > 0
        ? `이미 발행된 현금영수증 ${receiptsIssued}건은 그대로 있습니다 — 국세청 취소 신고는 따로 해주세요.`
        : null,
  });
}
