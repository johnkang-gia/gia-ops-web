import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 파일럿 체크인 페이지의 "운행 시작 / 5분전 / 운행 종료" 버튼이 부르는 곳입니다.
// shuttle_run_events(설계는 돼있었지만 화면과 연결된 적 없던 테이블)를 이번에 처음 씁니다.
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const token = body?.token as string | undefined;
  const event = body?.event as string | undefined;
  if (!token || !event || !["출발", "5분전", "도착"].includes(event)) {
    return NextResponse.json({ error: "token, event(출발|5분전|도착)가 필요합니다." }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: pilot, error: pilotError } = await supabase
    .from("shuttle_pilot_routes")
    .select("route_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (pilotError) return NextResponse.json({ error: pilotError.message }, { status: 500 });
  if (!pilot || !pilot.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);
  const { error: insertError } = await supabase.from("shuttle_run_events").insert({
    service_date: today,
    route_id: pilot.route_id,
    event,
    created_by: "파일럿(" + token.slice(0, 8) + ")",
  });
  if (insertError) {
    // '출발'은 같은 노선·같은 날 하나만 기록되도록 부분 유니크 인덱스로 막혀 있습니다
    // (v0.122.0 - 학교 도착체크·GPS 자동감지 크론이 이미 기록한 경우). 동승선생님 화면은
    // 더 이상 '출발'을 직접 보내지 않지만, 혹시 겹치더라도 이미 기록된 정상 상황이므로
    // 도착체크 API와 같은 방식으로 에러 취급하지 않습니다.
    if (insertError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
