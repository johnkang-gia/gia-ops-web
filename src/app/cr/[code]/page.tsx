import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * 상담실 짧은 주소(/cr/코드). 태블릿 주소창에 손으로 치기 쉽게 8글자만 씁니다. 실제 상담실 화면
 * (/consult-room/열쇠)로 넘겨 줍니다 - 현황판의 /cs/ 와 같은 방식입니다.
 */
export default async function ConsultRoomShortLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return <p className="p-10 text-center text-lg text-slate-600">서버 설정 오류입니다.</p>;
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await supabase
    .from("consult_rooms")
    .select("room_token, consult_events(status, room_links_enabled)")
    .eq("room_short_code", code.toLowerCase())
    .maybeSingle();
  const row = data as unknown as { room_token: string; consult_events: { status: string; room_links_enabled: boolean } | null } | null;
  if (!row || !row.consult_events?.room_links_enabled || row.consult_events.status === "종료") {
    return <p className="p-10 text-center text-lg text-slate-600">유효하지 않거나 닫힌 주소입니다.</p>;
  }
  redirect(`/consult-room/${row.room_token}`);
}
