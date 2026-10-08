import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRevision, parseSince } from "@/lib/boardRevision";
import { boardOpen, buildBoardPayload, loadConsultState } from "@/lib/consult/server";

export const dynamic = "force-dynamic";

/**
 * 상담 현황판(로그인 없음) — 태블릿·전자칠판이 3초마다 부릅니다.
 *
 * 열쇠(board_token, 추측할 수 없는 uuid)로 행사를 찾고 서비스 키로 읽되, **돌려보내는 것은
 * `buildBoardPayload` 가 고른 칸뿐입니다** - 학년·이름(행사 설정에 따라 가림)·상담실·상태·예상
 * 시간. 학생 번호·전화번호·메모는 담지 않습니다. 구글시트판은 화면에 안 쓰는 전화번호까지 실어
 * 보내서, 주소만 알면 그대로 받아 갈 수 있었습니다.
 *
 * 번호가 같으면(아무것도 안 바뀌었으면) 한 줄만 돌려줍니다 - 하루 종일 켜 두는 화면이라
 * 매번 전부 읽으면 무료 한도를 먹습니다(boardRevision.ts).
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ev, error } = await supabase
    .from("consult_events")
    .select("id, board_enabled, board_expires_at, status")
    .eq("board_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const event = ev as { id: string; board_enabled: boolean; board_expires_at: string | null; status: "준비" | "진행" | "종료" } | null;
  if (!event || !boardOpen(event, Date.now())) {
    return NextResponse.json({ error: "닫힌 현황판입니다. 행정실에 새 주소를 받아 주세요." }, { status: 403 });
  }

  const rev = await checkRevision(supabase, "consult", parseSince(req.url), `board:${event.id}`);
  if (!rev.stale) return NextResponse.json({ unchanged: true, revision: rev.revision });

  const { state, error: stErr } = await loadConsultState(supabase, event.id, { phones: false });
  if (!state) return NextResponse.json({ error: stErr ?? "현황을 읽지 못했습니다." }, { status: 500 });
  return NextResponse.json({ board: buildBoardPayload(state, Date.now()), revision: rev.revision });
}
