import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 체크인 화면이 운행 중 가속도 센서로 감지한 급가속/급감속 "기준치 초과 순간"을 기록하는
// 곳입니다(3단계-a). 위치 핑(event/ping)과 같은 토큰 검증 패턴입니다 - 매 순간이 아니라
// 클라이언트가 이미 걸러낸 이벤트만 오므로 쓰기 빈도는 낮습니다.
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const token = body?.token as string | undefined;
  const eventType = body?.eventType as string | undefined;
  const magnitude = body?.magnitude as number | undefined;
  if (!token || !eventType || !["급가속", "급감속"].includes(eventType)) {
    return NextResponse.json({ error: "token, eventType(급가속|급감속)이 필요합니다." }, { status: 400 });
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
  const { error: insertError } = await supabase.from("shuttle_safety_events").insert({
    service_date: today,
    route_id: pilot.route_id,
    event_type: eventType,
    magnitude: typeof magnitude === "number" ? magnitude : null,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
