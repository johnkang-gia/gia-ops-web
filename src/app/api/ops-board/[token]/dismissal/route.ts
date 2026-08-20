import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/shuttleTracking";

export const dynamic = "force-dynamic";

// 요청: "셔틀시작시간때(4:00)가 되면 화면이 전환되면서 실시간 셔틀 운행지도가 뜨고 지도에서 각
// 셔틀이 어떤 경로로 가고있는지 볼 수 있게 하면서, 아래쪽에는 아이들이 차량을 다 탑승했는지
// 하원차량 체크화면이 뜨고, 거기에서 몇호가 도착했고, 또 출발했는지 기사님의 핸드폰을 통해서
// 추척하고 더 정확하게 매번 자동으로 수정하도록 하는 시스템"
//
// 사무실 대형 모니터(로그인 없는 토큰 링크)에서 부르는 API라 service role로 조회합니다.
// 한 번에 내려주는 것
//   ① 노선별 최신 GPS 위치(기사님 휴대폰 Traccar) - 지도 위 차량 마커
//   ② 노선 경로(실도로 캐시가 있으면 그것, 없으면 정류장 직선) + 정류장 목록
//   ③ 오늘 도착·출발 이벤트(사람이 눌렀는지 GPS가 자동으로 잡았는지 구분)
//   ④ 노선별 탑승 현황(탑승/미탑승/대기, 픽업·결석 제외)

const PING_FRESH_MS = 10 * 60 * 1000; // 이보다 오래된 위치는 "신호 끊김"으로 표시합니다.

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link } = await supabase.from("ops_board_links").select("label, enabled").eq("token", token).maybeSingle();
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const now = Date.now();
  const { iso: today, weekday } = kstParts(new Date(now));

  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name, vehicle_no, driver_name, driver_phone, depart_time")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", "정규학기")
    .order("sort_order");
  const routeIds = (routes ?? []).map((r) => r.id);
  if (routeIds.length === 0) {
    return NextResponse.json({ label: link.label, today, routes: [], school: null });
  }

  const [{ data: stops }, { data: paths }, { data: events }, { data: pings }] = await Promise.all([
    supabase.from("shuttle_stops").select("id, route_id, seq, stop_time, address, lat, lng").in("route_id", routeIds).order("seq"),
    supabase.from("shuttle_route_paths").select("route_id, path").in("route_id", routeIds),
    supabase
      .from("shuttle_run_events")
      .select("route_id, event, created_at, created_by")
      .eq("service_date", today)
      .in("route_id", routeIds)
      .order("created_at", { ascending: true }),
    // 최근 위치만 필요해서 넉넉히 가져온 뒤 노선별 첫 행(가장 최신)만 씁니다.
    supabase
      .from("shuttle_pilot_pings")
      .select("route_id, lat, lng, speed, recorded_at")
      .in("route_id", routeIds)
      .gte("recorded_at", new Date(now - PING_FRESH_MS).toISOString())
      .order("recorded_at", { ascending: false }),
  ]);

  const stopsByRoute = new Map<string, { id: string; seq: number; stopTime: string | null; address: string | null; lat: number | null; lng: number | null }[]>();
  for (const s of stops ?? []) {
    const list = stopsByRoute.get(s.route_id) ?? [];
    list.push({ id: s.id, seq: s.seq, stopTime: s.stop_time, address: s.address, lat: s.lat, lng: s.lng });
    stopsByRoute.set(s.route_id, list);
  }

  const pathByRoute = new Map<string, { lat: number; lng: number }[]>();
  for (const p of paths ?? []) {
    if (Array.isArray(p.path)) pathByRoute.set(p.route_id, p.path as { lat: number; lng: number }[]);
  }

  const latestPingByRoute = new Map<string, { lat: number; lng: number; speed: number | null; recordedAt: string }>();
  for (const p of pings ?? []) {
    if (!latestPingByRoute.has(p.route_id)) {
      latestPingByRoute.set(p.route_id, { lat: p.lat, lng: p.lng, speed: p.speed, recordedAt: p.recorded_at });
    }
  }

  const eventsByRoute = new Map<string, { event: string; createdAt: string; createdBy: string | null }[]>();
  for (const e of events ?? []) {
    const list = eventsByRoute.get(e.route_id) ?? [];
    list.push({ event: e.event, createdAt: e.created_at, createdBy: e.created_by });
    eventsByRoute.set(e.route_id, list);
  }

  // ── 탑승 현황 ────────────────────────────────────────────────────────────────
  // 하원 체크표에서 오늘 하루만 다른 노선으로 옮긴 학생까지 반영합니다(도착체크 API와 같은 규칙).
  const stopIds = (stops ?? []).map((s) => s.id);
  const { data: assignments } = stopIds.length
    ? await supabase.from("shuttle_assignments").select("id, stop_id, student_name_raw, weekdays, override_route_id").in("stop_id", stopIds)
    : { data: [] as { id: string; stop_id: string; student_name_raw: string; weekdays: number[]; override_route_id: string | null }[] };
  const relevant = (assignments ?? []).filter((a) => (a.weekdays as number[]).includes(weekday));
  const assignmentIds = relevant.map((a) => a.id);

  const { data: boardings } = assignmentIds.length
    ? await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status, override_route_id")
        .eq("service_date", today)
        .in("assignment_id", assignmentIds)
    : { data: [] as { assignment_id: string; status: string; override_route_id: string | null }[] };
  const boardingByAssignment = new Map((boardings ?? []).map((b) => [b.assignment_id, b]));
  const stopRouteById = new Map((stops ?? []).map((s) => [s.id, s.route_id]));
  const routeIdSet = new Set(routeIds);

  type Rider = { name: string; status: string };
  const ridersByRoute = new Map<string, Rider[]>();
  for (const a of relevant) {
    const baseRouteId = stopRouteById.get(a.stop_id);
    if (!baseRouteId) continue;
    const b = boardingByAssignment.get(a.id);
    const permanent = a.override_route_id && routeIdSet.has(a.override_route_id) ? a.override_route_id : baseRouteId;
    const target = b?.override_route_id && routeIdSet.has(b.override_route_id) ? b.override_route_id : permanent;
    const list = ridersByRoute.get(target) ?? [];
    list.push({ name: a.student_name_raw, status: b?.status ?? "예정" });
    ridersByRoute.set(target, list);
  }

  const school = await (async () => {
    const { data } = await supabase.from("shuttle_campus_locations").select("lat, lng").eq("name", "본교").maybeSingle();
    return data?.lat != null && data?.lng != null ? { lat: data.lat as number, lng: data.lng as number } : null;
  })();

  const payload = (routes ?? []).map((r) => {
    const evts = eventsByRoute.get(r.id) ?? [];
    const arrived = evts.find((e) => e.event === "현장도착");
    const departed = evts.find((e) => e.event === "출발");
    const riders = (ridersByRoute.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    // 픽업·결석은 이 차를 안 타므로 탑승 진행률에서 뺍니다.
    const expected = riders.filter((x) => x.status !== "픽업" && x.status !== "결석");
    const boarded = expected.filter((x) => x.status === "탑승");
    const ping = latestPingByRoute.get(r.id) ?? null;

    return {
      routeId: r.id as string,
      routeNo: r.route_no as string,
      name: (r.name as string | null) ?? null,
      vehicleNo: (r.vehicle_no as string | null) ?? null,
      driverName: (r.driver_name as string | null) ?? null,
      departTime: (r.depart_time as string | null)?.slice(0, 5) ?? null,
      // 상태: 대기 → 도착함 → 운행중(출발) 순서로 넘어갑니다.
      status: departed ? "운행중" : arrived ? "도착함" : "대기",
      arrivedAt: arrived?.createdAt ?? null,
      departedAt: departed?.createdAt ?? null,
      // 사람이 눌렀는지 GPS가 자동으로 잡았는지 구분해서 보여줍니다(요청: "기사님의 핸드폰을
      // 통해서 추척하고 더 정확하게 매번 자동으로 수정").
      arrivedAuto: arrived?.createdBy === "GPS 자동감지",
      departedAuto: departed?.createdBy === "GPS 자동감지" || departed?.createdBy === "시간초과 자동정리",
      departedBy: departed?.createdBy ?? null,
      ping,
      pingFresh: !!ping && now - new Date(ping.recordedAt).getTime() < PING_FRESH_MS,
      path: pathByRoute.get(r.id) ?? null,
      stops: (stopsByRoute.get(r.id) ?? []).filter((s) => s.lat != null && s.lng != null),
      riders: expected.map((x) => ({ name: x.name, boarded: x.status === "탑승" })),
      boardedCount: boarded.length,
      expectedCount: expected.length,
      pickupCount: riders.filter((x) => x.status === "픽업").length,
      absentCount: riders.filter((x) => x.status === "결석").length,
    };
  });

  return NextResponse.json({ label: link.label, today, school, routes: payload });
}
