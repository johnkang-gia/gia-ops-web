import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 안내보드 짧은 주소(요청: "주소가 너무 복잡해서 바로 주소를 공용컴퓨터 주소창에 치는게
// 어려워... 짧은 주소로 만들어줘"). /b/{짧은코드}로 접속하면 shuttle_board_links.short_code로
// 실제 안내보드 토큰 링크(/shuttle-board/[token])를 찾아 바로 이동시켜줍니다. 로그인이 필요
// 없는 공개 리다이렉트라 service role로 조회합니다(안내보드 API와 같은 패턴).
export default async function ShortBoardLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-lg font-bold text-slate-600">서버 설정 오류입니다.</p>
      </div>
    );
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link } = await supabase
    .from("shuttle_board_links")
    .select("token, enabled")
    .eq("short_code", code.toLowerCase())
    .maybeSingle();

  if (!link || !link.enabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-lg font-bold text-slate-600">유효하지 않거나 종료된 주소입니다.</p>
      </div>
    );
  }

  redirect(`/shuttle-board/${link.token}`);
}
