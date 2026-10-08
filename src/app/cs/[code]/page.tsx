import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * 상담 현황판 짧은 주소(/cs/코드). 전자칠판 주소창에 손으로 치기 쉽게 8글자만 씁니다. 실제
 * 현황판 주소(/consult-board/열쇠)로 넘겨 줍니다 - 안내보드의 /b/ 와 같은 방식입니다.
 */
export default async function ConsultShortLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return <p className="p-10 text-center text-lg text-slate-600">서버 설정 오류입니다.</p>;
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await supabase
    .from("consult_events")
    .select("board_token, board_enabled, status")
    .eq("board_short_code", code.toLowerCase())
    .maybeSingle();
  const ev = data as { board_token: string; board_enabled: boolean; status: string } | null;
  if (!ev || !ev.board_enabled || ev.status === "종료") {
    return <p className="p-10 text-center text-lg text-slate-600">유효하지 않거나 닫힌 주소입니다.</p>;
  }
  redirect(`/consult-board/${ev.board_token}`);
}
