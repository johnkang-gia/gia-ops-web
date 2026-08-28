// 하원 셔틀 자동 도착·출발 감지 로직.
//
// 예전에는 /api/cron/shuttle-auto-arrive 와 /api/cron/shuttle-auto-depart 두 라우트가
// 각자 이 코드를 갖고, 각자 1분마다 불려, 각자 25초씩 함수를 붙잡았습니다. 그런데 둘은
// **같은 시각에 같은 표(shuttle_run_events)를 각자 조회**하고 있었습니다 - 한 번 조회해
// 둘 다 판단하면 될 일을 두 번 하고 있었던 셈입니다.
//
// 로직을 여기로 옮기고 /api/cron/shuttle-auto 한 곳에서 순서대로 부릅니다(도착을 먼저 찍어야
// 출발 판단이 가능하므로 순서가 있습니다). 루프 시간과 DB 왕복이 모두 절반이 됩니다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineMeters } from "@/lib/shuttleRecommend";
import { ensureCampusLocation } from "@/lib/shuttleCampus";
import { kstParts } from "@/lib/shuttleTracking";

// 하원 판정 기준 시각 - 오후 4시(한국).
//
// 담당자: "16시가 정확히 기준시간이니 16시에 측정해서 결과값으로 가리자. 16시에 학교
//          근처에 있다면 도착으로 체크, (신호는 15시 30분부터 받지만 도착·미도착 표시는
//          안 함) 16시 이후 멀어지면 그걸 출발로 하자."
//
// 노선별 출발 예정시각으로 각각 다르게 재던 것을 이 한 줄로 바꿉니다. 규칙이 하나면
// 화면에서 "왜 저 차만 다르지"가 없고, 예정시각이 비어 있거나 틀린 노선에서도 똑같이
// 동작합니다. 신호는 15시 30분부터 계속 받되, **판정만 4시부터** 합니다.
const DISMISSAL_CUTOFF_MIN = 16 * 60;


// ── arrive ──────────────────────────────────────────

// 이보다 오래된 핑은 "지금 상황"으로 믿지 않습니다.
const PING_FRESHNESS_MS = 3 * 60 * 1000;
// 학교 위치에서 이 거리(m) 안에 들어오면 도착 후보로 봅니다(출발 감지와 같은 반경).
const ARRIVE_RADIUS_M = 100;
// 학교 앞을 그냥 지나가기만 한 경우를 걸러내려고, 반경 안 핑이 이만큼 이어져야 도착으로 봅니다.
const ARRIVE_MIN_DWELL_MS = 60 * 1000;
// 반경 안에 있었다고 인정할 최소 핑 개수(한 점이 튀어서 오탐하는 것을 막습니다).
const ARRIVE_MIN_SAMPLES = 2;


/**
 * @param onlyRouteId 한 노선만 볼 때. GPS 핑이 들어온 그 순간 그 차만 판단하려고 씁니다.
 */
export async function runAutoArrivePass(
  supabase: SupabaseClient,
  onlyRouteId?: string
): Promise<{ arrived: number }> {
  const now = Date.now();
  const { iso: today, hour, minute } = kstParts(new Date(now));

  // 4시 전에는 도착·미도착을 아예 표시하지 않습니다.
  //
  // 기사님이 일찍 와서 차를 대는 것은 하원과 무관한 일입니다. 그걸 "도착함"으로 띄우면
  // **안내보드를 보고 아이들이 그때 나가버립니다.** 신호는 계속 받아 지도에 그리되,
  // 판정은 4시부터 시작합니다.
  if (hour * 60 + minute < DISMISSAL_CUTOFF_MIN) return { arrived: 0 };

  // 오늘 이미 도착/출발이 찍힌 노선은 건드리지 않습니다.
  const { data: events } = await supabase
    .from("shuttle_run_events")
    .select("route_id, event")
    .eq("service_date", today)
    .in("event", ["현장도착", "출발"]);
  const handledRoutes = new Set((events ?? []).map((e) => e.route_id));

  // 추적 기기가 켜져 있는 노선만 대상으로 합니다.
  const deviceQuery = supabase.from("shuttle_tracker_devices").select("route_id").eq("enabled", true);
  const { data: devices } = onlyRouteId ? await deviceQuery.eq("route_id", onlyRouteId) : await deviceQuery;
  const targetRouteIds = [...new Set((devices ?? []).map((d) => d.route_id))].filter((id) => !handledRoutes.has(id));
  if (targetRouteIds.length === 0) return { arrived: 0 };

  const campus = await ensureCampusLocation(supabase);
  if (!campus) return { arrived: 0 };

  const pingCutoff = new Date(now - PING_FRESHNESS_MS).toISOString();
  const { data: pings } = await supabase
    .from("shuttle_pilot_pings")
    .select("route_id, lat, lng, accuracy, recorded_at")
    .in("route_id", targetRouteIds)
    .gte("recorded_at", pingCutoff)
    .order("recorded_at", { ascending: true });

  const byRoute = new Map<string, { lat: number; lng: number; accuracy: number | null; recorded_at: string }[]>();
  for (const p of pings ?? []) {
    const list = byRoute.get(p.route_id) ?? [];
    list.push(p);
    byRoute.set(p.route_id, list);
  }

  let arrived = 0;
  for (const routeId of targetRouteIds) {
    const list = byRoute.get(routeId);
    if (!list || list.length < ARRIVE_MIN_SAMPLES) continue;

    // 가장 최근 핑이 반경 밖이면 아직 도착한 게 아닙니다(지나가는 중이거나 이미 떠난 경우).
    const inRadius = list.filter(
      (p) =>
        (p.accuracy == null || p.accuracy <= ARRIVE_RADIUS_M) &&
        haversineMeters(campus.lat, campus.lng, p.lat, p.lng) <= ARRIVE_RADIUS_M
    );
    if (inRadius.length < ARRIVE_MIN_SAMPLES) continue;
    if (inRadius[inRadius.length - 1] !== list[list.length - 1]) continue;

    // 반경 안에 머문 시간이 충분해야 "그냥 지나감"이 아니라 "도착해서 섰다"로 봅니다.
    const dwellMs = new Date(inRadius[inRadius.length - 1].recorded_at).getTime() - new Date(inRadius[0].recorded_at).getTime();
    if (dwellMs < ARRIVE_MIN_DWELL_MS) continue;

    const { error } = await supabase
      .from("shuttle_run_events")
      .insert({ service_date: today, route_id: routeId, event: "현장도착", created_by: "GPS 자동감지" });
    // 23505는 다른 경로로 이미 도착이 찍힌 정상 상황이라 에러로 세지 않습니다.
    if (!error) arrived += 1;
  }

  return { arrived };
}


// ── depart ──────────────────────────────────────────

// 도착 찍은 직후 곧바로 자동 출발되지 않도록 최소한 이만큼은 기다립니다(핸들 도중 GPS가
// 잠깐 튀어도 오작동하지 않도록 하는 안전장치).
const MIN_DWELL_MS = 90 * 1000;
// 학교 위치에서 이 거리(m) 이상 멀어진 GPS 핑이 있으면 "출발"로 봅니다.
//
// 담당자: "27호 기사님이 일찍 도착해서 잠깐 차 댔다가, 4시 하원이니까 차를 끌고 이동하시는데
//          이게 집계돼서 출발함으로 떠 있어."
//
// 100m는 **주차 자리를 옮기는 것과 진짜 떠나는 것을 못 가릅니다.** 학교 앞에서 차를 빼
// 골목 한 바퀴 돌면 그냥 넘습니다. 250m로 넓혔습니다.
const DEPART_RADIUS_M = 250;


// GPS 핑이 아예 없는 노선을 위한 시간 기반 안전장치(분).
const TIME_FALLBACK_MIN = 20;

export async function runAutoDepartPass(
  supabase: SupabaseClient,
  onlyRouteId?: string
): Promise<{ gpsDeparted: number; timeoutDeparted: number }> {
  // 날짜는 **한국 기준**이어야 합니다. 도착(runAutoArrivePass)은 kstParts로 한국 날짜를
  // 쓰는데 여기만 toISOString()(UTC)이었습니다. 두 함수가 서로 다른 날을 보면, 도착은
  // 찍혔는데 출발은 "오늘 도착한 차가 없다"며 영영 안 찍힙니다.
  const now = Date.now();
  const { iso: today, hour, minute } = kstParts(new Date(now));

  // 도착과 같은 기준. 4시 전에 멀어진 것은 무슨 일이든 하원 출발이 아닙니다
  // (일찍 와서 잠깐 댔다가 차 자리를 옮기는 중).
  if (hour * 60 + minute < DISMISSAL_CUTOFF_MIN) return { gpsDeparted: 0, timeoutDeparted: 0 };

  const { data: events } = await supabase
    .from("shuttle_run_events")
    .select("route_id, event, created_at")
    .eq("service_date", today)
    .in("event", ["현장도착", "출발"]);

  const arrivedAt = new Map<string, string>();
  const departedRoutes = new Set<string>();
  for (const e of events ?? []) {
    if (e.event === "현장도착") arrivedAt.set(e.route_id, e.created_at);
    if (e.event === "출발") departedRoutes.add(e.route_id);
  }

  const pendingRouteIds = [...arrivedAt.keys()].filter((routeId) => {
    if (onlyRouteId && routeId !== onlyRouteId) return false;
    if (departedRoutes.has(routeId)) return false;
    const arrivedTime = new Date(arrivedAt.get(routeId)!).getTime();
    return now - arrivedTime >= MIN_DWELL_MS;
  });

  if (pendingRouteIds.length === 0) return { gpsDeparted: 0, timeoutDeparted: 0 };

  const campus = await ensureCampusLocation(supabase);

  const pingCutoff = new Date(now - PING_FRESHNESS_MS).toISOString();
  const { data: pings } = await supabase
    .from("shuttle_pilot_pings")
    .select("route_id, lat, lng, accuracy, recorded_at")
    .in("route_id", pendingRouteIds)
    .gte("recorded_at", pingCutoff)
    .order("recorded_at", { ascending: false });

  const latestPingByRoute = new Map<string, { lat: number; lng: number; accuracy: number | null }>();
  for (const p of pings ?? []) {
    if (!latestPingByRoute.has(p.route_id)) {
      latestPingByRoute.set(p.route_id, { lat: p.lat, lng: p.lng, accuracy: p.accuracy });
    }
  }

  let gpsDeparted = 0;
  let timeoutDeparted = 0;

  for (const routeId of pendingRouteIds) {
    const ping = latestPingByRoute.get(routeId);

    if (campus && ping && (ping.accuracy == null || ping.accuracy <= DEPART_RADIUS_M)) {
      const distance = haversineMeters(campus.lat, campus.lng, ping.lat, ping.lng);
      if (distance >= DEPART_RADIUS_M) {
        const { error } = await supabase
          .from("shuttle_run_events")
          .insert({ service_date: today, route_id: routeId, event: "출발", created_by: "GPS 자동감지" });
        if (!error) gpsDeparted += 1;
        continue;
      }
    }

    // GPS 핑이 없는(또는 부정확한) 노선은 시간 기반 안전장치로 넘어갑니다 - "실제로 떠났다"는
    // 확인 없이 화면만 정리하는 것이므로 20분으로 넉넉하게 잡습니다.
    if (!ping) {
      const arrivedTime = new Date(arrivedAt.get(routeId)!).getTime();
      if (now - arrivedTime >= TIME_FALLBACK_MIN * 60 * 1000) {
        const { error } = await supabase
          .from("shuttle_run_events")
          .insert({ service_date: today, route_id: routeId, event: "출발", created_by: "시간초과 자동정리" });
        if (!error) timeoutDeparted += 1;
      }
    }
  }

  return { gpsDeparted, timeoutDeparted };
}
