import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 운영 대시보드 짧은 주소(요청: "운영안내 대시보드 주소 간결하게 만들어주고, 다른곳에서 바로
// 주소만쳐서 들어갈 수 있게").
//
// /d/{짧은코드}로 접속하면 ops_board_links.short_code로 실제 대시보드 링크(/ops-board/[token])를
// 찾아 바로 이동시켜줍니다. 안내보드의 /b/{코드}와 같은 방식이고, 주소 앞글자만 d(dashboard)로
// 달라 두 화면이 헷갈리지 않습니다.
//
// 로그인이 필요 없는 공개 리다이렉트라 service role로 조회합니다(대시보드 API와 같은 패턴).
export default async function ShortOpsBoardLinkPage({ params }: { params: Promise<{ code: string }> }) {
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
    .from("ops_board_links")
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

  redirect(`/ops-board/${link.token}`);
}
