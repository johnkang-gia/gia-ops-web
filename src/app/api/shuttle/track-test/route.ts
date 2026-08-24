import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";

export const dynamic = "force-dynamic";

// 강경원 본인 휴대폰 GPS 테스트용(요청). always_on 기기의 오늘 위치를 실시간·히스토리로 봅니다.
// 로그인한 관리자/행정직원만 볼 수 있고, 실제 위치 조회는 service role로 합니다.
const TEST_DEVICE_ID = "e0000000-0000-4000-b000-000000000001";

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me || !isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: device } = await supabase
    .from("shuttle_tracker_devices")
    .select("id, route_id, label, setup_code, last_seen_at, always_on, enabled")
    .eq("id", TEST_DEVICE_ID)
    .maybeSingle();
  if (!device) {
    return NextResponse.json({ error: "테스트 기기가 아직 등록되지 않았습니다. 마이그레이션을 적용해 주세요." }, { status: 404 });
  }

  // 오늘(자정 이후)의 위치 이력. 시간 순(옛→새)으로 정렬해 경로선/타임라인에 그대로 씁니다.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: pings } = await supabase
    .from("shuttle_pilot_pings")
    .select("lat, lng, speed, recorded_at")
    .eq("route_id", device.route_id)
    .gte("recorded_at", startOfDay.toISOString())
    .order("recorded_at", { ascending: true })
    .limit(2000);

  const history = (pings ?? []).map((p) => ({
    lat: p.lat as number,
    lng: p.lng as number,
    speed: (p.speed as number | null) ?? null,
    at: p.recorded_at as string,
  }));
  const latest = history.length ? history[history.length - 1] : null;
  const now = Date.now();

  return NextResponse.json({
    label: device.label ?? "강경원 테스트",
    setupCode: device.setup_code ?? null,
    alwaysOn: !!device.always_on,
    enabled: !!device.enabled,
    lastSeen: device.last_seen_at ?? null,
    live: latest && now - new Date(latest.at).getTime() < 3 * 60 * 1000 ? latest : null,
    latest,
    count: history.length,
    history,
  });
}
