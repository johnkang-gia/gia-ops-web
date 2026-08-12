import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 요청: "gia출발부터 마지막 정류장 도착까지 켜두고 계속 주기적으로 전달하도록 해줘... 키고
// 끄는 걸 우리가 제어하게끔 해줘" - 동승선생님 화면(PilotCheckinClient)이 버튼 없이도 학교
// '현장도착'을 감지해 위치 전송을 자동으로 시작할 수 있도록, 아직 시작 전이라면 이 API를
// 짧은 주기로 폴링해 오늘 이 노선의 도착 상태를 확인합니다. 위치 전송이 시작된 뒤에는 더 이상
// 부르지 않습니다(불필요한 배터리 소모를 줄이기 위해).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token이 필요합니다." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: pilot } = await supabase.from("shuttle_pilot_routes").select("route_id, enabled").eq("token", token).maybeSingle();
  if (!pilot || !pilot.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: events } = await supabase
    .from("shuttle_run_events")
    .select("event")
    .eq("route_id", pilot.route_id)
    .eq("service_date", today)
    .in("event", ["현장도착", "도착"]);

  const hasArrived = (events ?? []).some((e) => e.event === "현장도착");
  const hasFinalArrived = (events ?? []).some((e) => e.event === "도착");

  return NextResponse.json({ hasArrived, hasFinalArrived });
}
