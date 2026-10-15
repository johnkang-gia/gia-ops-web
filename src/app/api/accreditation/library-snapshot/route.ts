import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { logApiError } from "@/lib/logging";

/**
 * **도서관 기준선 한 줄 남기기.**
 *
 * 인증 개선 계획은 "무엇을 얼마에서 얼마로"가 적혀 있어야 성립합니다. 그런데 화면은 늘 '오늘'만 보여주므로, 출발점 숫자를
 * 날짜와 함께 어딘가에 고정해 두지 않으면 1년 뒤에 비교할 대상이 없습니다.
 *
 * 세는 일은 하지 않습니다 - 데이터베이스 함수(lib_take_stat_snapshot)가 셉니다. 앱에서 세면 앱이 바뀔 때마다 규칙이
 * 조용히 달라지고, 작년 줄과 올해 줄이 서로 다른 규칙으로 세어진 것이면 나란히 놓을 수 없습니다.
 *
 * 같은 날 다시 누르면 그 날 줄을 덮어씁니다(하루 한 줄). 하루에 여러 줄이 쌓이면 "그래서 그날 숫자가 뭐냐"에 답이 둘입니다.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const me = await getCurrentAppUser();
    if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

    const body = (await req.json().catch(() => null)) as { note?: string } | null;
    const note = (body?.note ?? "").trim() || null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("lib_take_stat_snapshot", { p_note: note });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, snapshot: data });
  } catch (e) {
    await logApiError(await createClient(), "api/accreditation/library-snapshot", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "기록하지 못했습니다." }, { status: 500 });
  }
}
