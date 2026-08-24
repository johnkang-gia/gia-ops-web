import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";

export const dynamic = "force-dynamic";

// GPS 테스트 화면용. 요청: "지도 크게 (...) 노선이 보이도록 (...) GIA에서부터 출발하면서 지나는
// 경로 선으로 트래킹 (...) 우선은 테스트인 27호만 먼저 트래킹".
//
// 지금 실제로 신호를 보내고 있는 기기(=테스트 중인 노선)를 자동으로 골라, 그 노선의 계획 경로·
// 정류장·학교(GIA) 좌표와 오늘 실제 이동 자취(핑)를 함께 내려줍니다. 화면은 이걸로 노선 전체가
// 한눈에 들어오게 지도를 맞추고, 지나온 길을 색선으로 그립니다.
const ALWAYS_ON_FALLBACK = "e0000000-0000-4000-b000-000000000001";

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me || !isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 신호를 가장 최근에 보낸 기기 = 지금 테스트 중인 노선. 없으면 강경원 24시간 테스트 기기로.
  const { data: devices } = await supabase
    .from("shuttle_tracker_devices")
    .select("id, route_id, label, device_id, last_seen_at, last_hit_at, last_hit_reason, setup_code, always_on, enabled")
    .eq("enabled", true);
  const list = devices ?? [];
  const active = [...list].sort((a, b) => {
    const ta = new Date((a.last_hit_at as string) ?? (a.last_seen_at as string) ?? 0).getTime();
    const tb = new Date((b.last_hit_at as string) ?? (b.last_seen_at as string) ?? 0).getTime();
    return tb - ta;
  })[0];
  const device = active ?? list.find((d) => d.id === ALWAYS_ON_FALLBACK) ?? null;
  if (!device) {
    return NextResponse.json({ error: "등록된 기기가 없습니다. 마이그레이션·기기 발급을 확인해 주세요." }, { status: 404 });
  }
  const routeId = device.route_id as string;

  const [{ data: route }, { data: pathRow }, { data: stops }, { data: campus }] = await Promise.all([
    supabase.from("shuttle_routes").select("route_no, name").eq("id", routeId).maybeSingle(),
    supabase.from("shuttle_route_paths").select("path").eq("route_id", routeId).maybeSingle(),
    supabase.from("shuttle_stops").select("seq, address, lat, lng, gps_lat, gps_lng").eq("route_id", routeId).order("seq"),
    supabase.from("shuttle_campus_locations").select("lat, lng").eq("name", "본교").maybeSingle(),
  ]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: pings } = await supabase
    .from("shuttle_pilot_pings")
    .select("lat, lng, speed, recorded_at")
    .eq("route_id", routeId)
    .gte("recorded_at", startOfDay.toISOString())
    .order("recorded_at", { ascending: true })
    .limit(3000);

  const trail = (pings ?? []).map((p) => ({
    lat: p.lat as number,
    lng: p.lng as number,
    speed: (p.speed as number | null) ?? null,
    at: p.recorded_at as string,
  }));
  const latest = trail.length ? trail[trail.length - 1] : null;
  const now = Date.now();

  // 계획 경로: 실도로 캐시가 있으면 그것, 없으면 정류장을 이은 선.
  const plannedFromPath = Array.isArray(pathRow?.path) ? (pathRow!.path as { lat: number; lng: number }[]) : null;
  const stopPoints = (stops ?? [])
    .map((s) => ({
      lat: ((s.gps_lat as number | null) ?? (s.lat as number | null)),
      lng: ((s.gps_lng as number | null) ?? (s.lng as number | null)),
      seq: s.seq as number,
      address: (s.address as string | null) ?? null,
    }))
    .filter((s) => s.lat != null && s.lng != null) as { lat: number; lng: number; seq: number; address: string | null }[];
  const planned = plannedFromPath ?? stopPoints.map((s) => ({ lat: s.lat, lng: s.lng }));

  return NextResponse.json({
    routeNo: (route?.route_no as string | null) ?? null,
    routeName: (route?.name as string | null) ?? null,
    label: (device.label as string | null) ?? null,
    deviceId: device.device_id as string,
    setupCode: (device.setup_code as string | null) ?? null,
    alwaysOn: !!device.always_on,
    lastSeen: (device.last_seen_at as string | null) ?? null,
    lastHitAt: (device.last_hit_at as string | null) ?? null,
    lastHitReason: (device.last_hit_reason as string | null) ?? null,
    school: campus?.lat != null && campus?.lng != null ? { lat: campus.lat as number, lng: campus.lng as number } : null,
    planned, // 계획 경로선
    stops: stopPoints, // 정류장 점
    trail, // 오늘 실제 이동 자취
    latest,
    live: latest && now - new Date(latest.at).getTime() < 3 * 60 * 1000 ? latest : null,
    count: trail.length,
  });
}
