import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 안내보드에서 "자유롭게 검색해서 클릭"할 수 있게 해주는 유튜브 검색 API입니다(요청: "크롬창을
// 작게 가져와서 자유롭게 서치 해서 클릭할 수 있게 해주고"). 실제 유튜브 사이트는 보안 정책상
// iframe 안에 통째로 넣을 수 없고, 예전에 있던 "임베드 안에서 검색" 기능(listType=search)도
// 2020년에 구글이 완전히 없애서, 구글의 YouTube Data API로 직접 검색해 결과 썸네일을 우리
// 화면에 그려주고, 클릭하면 기존 임베드 플레이어(/embed/영상ID)로 재생하는 방식을 씁니다.
// 아무나 API 키를 낭비하지 못하도록, 안내보드 토큰(shuttle_board_links.token)이 유효할 때만
// 검색을 허용합니다.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const q = searchParams.get("q")?.trim();
  if (!token || !q) {
    return NextResponse.json({ error: "token, q가 필요합니다." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }
  if (!youtubeKey) {
    return NextResponse.json({ error: "유튜브 검색 기능이 아직 설정되지 않았습니다(YOUTUBE_API_KEY 필요)." }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: link } = await supabase.from("shuttle_board_links").select("enabled").eq("token", token).maybeSingle();
  if (!link || !link.enabled) {
    return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });
  }

  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  apiUrl.searchParams.set("part", "snippet");
  apiUrl.searchParams.set("type", "video");
  apiUrl.searchParams.set("maxResults", "12");
  apiUrl.searchParams.set("safeSearch", "strict");
  apiUrl.searchParams.set("q", q);
  apiUrl.searchParams.set("key", youtubeKey);

  try {
    const res = await fetch(apiUrl.toString());
    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: json?.error?.message ?? "유튜브 검색에 실패했습니다." }, { status: 502 });
    }
    type YoutubeSearchItem = {
      id: { videoId?: string };
      snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string }; default?: { url: string } } };
    };
    const results = ((json.items ?? []) as YoutubeSearchItem[])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        videoId: item.id.videoId!,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? "",
      }));
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "유튜브 검색 중 오류가 발생했습니다." }, { status: 500 });
  }
}
