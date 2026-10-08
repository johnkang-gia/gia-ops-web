import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildPersonalPayload, loadConsultState } from "@/lib/consult/server";

export const dynamic = "force-dynamic";

/**
 * 학부모 개인 확인 링크(로그인 없음) — «내 순서까지 몇 명, 몇 분».
 *
 * 예약마다 따로 뽑은 열쇠(personal_token)로 그 예약 **하나만** 돌려줍니다. 다른 가정의 이름은
 * 담지 않고, 내 아이 이름도 가려서 보냅니다 - 링크는 단톡방에 잘못 올라가는 일이 있습니다.
 * 학부모 앱이 생기면 이 자리를 앱이 대신합니다.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: appt, error } = await supabase
    .from("consult_appointments")
    .select("id, event_id, consult_events(status, personal_links_enabled)")
    .eq("personal_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = appt as unknown as { id: string; event_id: string; consult_events: { status: string; personal_links_enabled: boolean } | null } | null;
  if (!row || !row.consult_events?.personal_links_enabled || row.consult_events.status === "종료") {
    return NextResponse.json({ error: "확인할 수 없는 링크입니다. 학교에 문의해 주세요." }, { status: 403 });
  }

  const { state, error: stErr } = await loadConsultState(supabase, row.event_id, { phones: false });
  if (!state) return NextResponse.json({ error: stErr ?? "현황을 읽지 못했습니다." }, { status: 500 });
  const me = buildPersonalPayload(state, row.id, Date.now());
  if (!me) return NextResponse.json({ error: "예약을 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ me });
}
