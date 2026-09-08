import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { enabledSpaces, seedSpacesFromEnv, syncSpaceList, syncSpaceMembers } from "@/lib/googleChat";

/**
 * 미러링할 구글챗 방을 고르는 창구.
 *
 * 방 목록이 코드·환경변수에 박혀 있으면 방 하나 더 보려고 배포를 해야 합니다. 방은 학기
 * 중에도 생깁니다 - 학년 방, 행사 방, 급할 때 그 자리에서 만드는 방.
 *
 * `GET`  - 우리가 아는 방 목록(켜짐 여부 포함)
 * `POST` - action: "sync"(구글에서 방 목록 새로고침) · "toggle"(켜기/끄기) · "members"(사람 목록)
 */

export const dynamic = "force-dynamic";

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 필요합니다." }, { status: 403 });

  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  // 예전 두 방을 표로 옮겨 심는 일은 여기서도 한 번 합니다 - 크론이 아직 안 돌았어도 화면을
  // 열면 목록이 비어 있지 않게.
  await seedSpacesFromEnv(supabase);

  const { data, error } = await supabase
    .from("google_chat_spaces")
    .select("google_space_id, display_name, source_key, enabled, sort_order, last_polled_at, last_error")
    .order("enabled", { ascending: false })
    .order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ spaces: data ?? [] });
}

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 필요합니다." }, { status: 403 });

  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "sync") {
    const res = await syncSpaceList(supabase);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
    return NextResponse.json(res);
  }

  if (action === "toggle") {
    const id = String(body?.spaceId ?? "").trim();
    const enabled = body?.enabled === true;
    if (!id) return NextResponse.json({ error: "어느 방인지 알 수 없습니다." }, { status: 400 });
    const { error } = await supabase
      .from("google_chat_spaces")
      .update({ enabled, last_error: null, updated_at: new Date().toISOString() })
      .eq("google_space_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // 켤 때는 사람 목록도 함께 받아둡니다 - @멘션을 쓰려면 번호가 있어야 하는데, 따로 눌러야
    // 받아지면 아무도 안 누르고 「멘션이 안 된다」로만 남습니다.
    if (enabled) await syncSpaceMembers(supabase, id);
    return NextResponse.json({ ok: true });
  }

  if (action === "members") {
    const id = String(body?.spaceId ?? "").trim();
    if (!id) return NextResponse.json({ error: "어느 방인지 알 수 없습니다." }, { status: 400 });
    const res = await syncSpaceMembers(supabase, id);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
    return NextResponse.json(res);
  }

  if (action === "members-all") {
    // 켜져 있는 방 전체의 사람 목록을 한 번에 받아둡니다.
    const spaces = await enabledSpaces(supabase);
    const failed: string[] = [];
    for (const s of spaces) {
      const res = await syncSpaceMembers(supabase, s.google_space_id);
      if (!res.ok) failed.push(`${s.display_name ?? s.google_space_id}: ${res.error}`);
    }
    if (failed.length > 0) return NextResponse.json({ error: failed.join(" · ") }, { status: 502 });
    return NextResponse.json({ ok: true, spaces: spaces.length });
  }

  return NextResponse.json({ error: `모르는 요청입니다: ${action || "(빈 값)"}` }, { status: 400 });
}
