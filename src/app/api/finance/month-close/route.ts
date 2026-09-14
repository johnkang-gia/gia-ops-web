import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * **월 마감** — 닫고, 다시 엽니다.
 *
 * ── 왜 닫나 ─────────────────────────────────────────────────────────────────
 *
 * 지난 달 청구서를 오늘 고치면 **지난달 보고서와 달라집니다.** 그런데 아무도 모릅니다 -
 * 보고서는 이미 나갔고, 화면은 새 숫자를 아무 표시 없이 보여줍니다.
 *
 * 닫은 달은 데이터베이스가 막습니다(트리거). 코드로만 막으면 화면 하나를 빠뜨렸을 때
 * 드러나지 않습니다.
 *
 * ── 왜 다시 열 수 있게 하나 ─────────────────────────────────────────────────
 *
 * 정말 고쳐야 하는 일이 생깁니다 - 환불이 늦게 결정되거나, 잘못 적은 것을 나중에 발견합니다.
 * 열쇠를 아예 없애면 사람은 **트리거를 끄거나 DB 를 직접 만집니다.** 그건 아무 기록도 안
 * 남습니다.
 *
 * 여는 것을 막지 않고 **눈에 띄게** 만듭니다 - 누가 왜 열었는지가 남고, 화면에 「다시 연 달」
 * 로 표시됩니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { month?: string; action?: "close" | "reopen"; note?: string; reason?: string }
    | null;

  const month = String(body?.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "닫을 달을 YYYY-MM 으로 골라주세요." }, { status: 400 });
  }
  const action = body?.action === "reopen" ? "reopen" : "close";
  const supabase = await createClient();

  if (action === "reopen") {
    const reason = String(body?.reason ?? "").trim();
    // **이유 없이는 못 엽니다.** 여는 것 자체를 막지 않는 대신, 왜 열었는지는 반드시 남습니다.
    if (!reason) return NextResponse.json({ error: "다시 여는 이유를 적어주세요." }, { status: 400 });

    const { data, error } = await supabase
      .from("finance_month_closes")
      .update({ reopened_at: new Date().toISOString(), reopened_by: me.email, reopen_reason: reason })
      .eq("month", month)
      .is("reopened_at", null)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: `${month} 은(는) 이미 열려 있습니다.` }, { status: 400 });
    return NextResponse.json({ ok: true, month, action });
  }

  // 닫습니다. 이미 닫혀 있으면 알려주고 끝냅니다 - 두 번 닫는다고 달라지는 것은 없지만,
  // 「닫았습니다」라고 답하면 방금 내가 닫은 줄 알게 됩니다.
  const { data: exist } = await supabase
    .from("finance_month_closes")
    .select("month, reopened_at")
    .eq("month", month)
    .maybeSingle();

  if (exist && !exist.reopened_at) {
    return NextResponse.json({ error: `${month} 은(는) 이미 마감되어 있습니다.` }, { status: 400 });
  }

  // 다시 연 달을 또 닫는 경우에는 **연 기록을 지웁니다.** 남겨두면 「열려 있는 달」로 읽힙니다.
  const { error } = await supabase
    .from("finance_month_closes")
    .upsert(
      {
        month,
        closed_at: new Date().toISOString(),
        closed_by: me.email,
        note: String(body?.note ?? "").trim() || null,
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
      },
      { onConflict: "month" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, month, action });
}
