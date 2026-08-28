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

/** 'HH:MM[:SS]' → 자정부터의 분. 못 읽으면 null. */
function timeToMinutes(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((t ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}


// ── arrive ──────────────────────────────────────────

// 이보다 오래된 핑은 "지금 상황"으로 믿지 않습니다.
const PING_FRESHNESS_MS = 3 * 60 * 1000;
// 학교 위치에서 이 거리(m) 안에 들어오면 도착 후보로 봅니다(출발 감지와 같은 반경).
const ARRIVE_RADIUS_M = 100;
// 학교 앞을 그냥 지나가기만 한 경우를 걸러내려고, 반경 안 핑이 이만큼 이어져야 도착으로 봅니다.
const ARRIVE_MIN_DWELL_MS = 60 * 1000;
// 반경 안에 있었다고 인정할 최소 핑 개수(한 점이 튀어서 오탐하는 것을 막습니다).
const ARRIVE_MIN_SAMPLES = 2;
// 출발 예정시각보다 이만큼 앞서기 전에는 도착으로 찍지 않습니다.
//
// 기사님이 한 시간 일찍 와서 차를 대고 계실 수 있습니다. 그걸 "도착함"으로 띄우면
// **안내보드를 보고 아이들이 그때 나가버립니다.** 차는 아직 태울 준비가 안 됐는데요.
// 하원 시각이 가까워졌을 때의 도착만 하원 도착으로 봅니다.
const ARRIVE_EARLIEST_BEFORE_MIN = 40;

/**
 * @param onlyRouteId 한 노선만 볼 때. GPS 핑이 들어온 그 순간 그 차만 판단하려고 씁니다.
 */
export async function runAutoArrivePass(
  supabase: SupabaseClient,
  onlyRouteId?: string
): Promise<{ arrived: number }> {
  const now = Date.now();
  const today = kstParts(new Date(now)).iso;

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

  // 노선별 출발 예정시각. 너무 이른 도착을 걸러내는 데 씁니다.
  const { data: routeRows } = await supabase
    .from("shuttle_routes")
    .select("id, depart_time")
    .in("id", targetRouteIds);
  const departMinByRoute = new Map<string, number | null>(
    (routeRows ?? []).map((r) => [r.id as string, timeToMinutes(r.depart_time as string | null)])
  );
  const { hour: nowHour, minute: nowMinute } = kstParts(new Date(now));
  const nowMinOfDay = nowHour * 60 + nowMinute;

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
    // 하원 시각과 한참 떨어진 시간에 학교에 있는 것은 "하원 도착"이 아닙니다.
    const departMin = departMinByRoute.get(routeId) ?? null;
    if (departMin != null && nowMinOfDay < departMin - ARRIVE_EARLIEST_BEFORE_MIN) continue;

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

// 출발 예정시각보다 이만큼 앞서기 전에는 자동 출발을 찍지 않습니다.
//
// 거리만으로는 절대 못 가립니다. 차를 옮기든 떠나든 GPS에는 똑같이 "멀어졌다"로 보입니다.
// 가르는 것은 거리가 아니라 **시각**입니다 - 하원 출발은 아이들을 태우고 가는 일이라
// 예정시각 언저리에만 일어납니다. 3시에 멀어진 것은 무슨 일이든 하원 출발이 아닙니다.
const DEPART_EARLIEST_BEFORE_MIN = 15;

// GPS 핑이 아예 없는 노선을 위한 시간 기반 안전장치(분).
const TIME_FALLBACK_MIN = 20;

export async function runAutoDepartPass(
  supabase: SupabaseClient,
  onlyRouteId?: string
): Promise<{ gpsDeparted: number; timeoutDeparted: number }> {
  // 날짜는 **한국 기준**이어야 합니다. 도착(runAutoArrivePass)은 kstParts로 한국 날짜를
  // 쓰는데 여기만 toISOString()(UTC)이었습니다. 두 함수가 서로 다른 날을 보면, 도착은
  // 찍혔는데 출발은 "오늘 도착한 차가 없다"며 영영 안 찍힙니다.
  const today = kstParts(new Date()).iso;
  const now = Date.now();

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

  // 노선별 출발 예정시각. 이걸 봐야 "일찍 와서 차를 옮긴 것"과 "하원 출발"을 가릅니다.
  const { data: routeRows } = await supabase
    .from("shuttle_routes")
    .select("id, depart_time")
    .in("id", pendingRouteIds);
  const departMinByRoute = new Map<string, number | null>(
    (routeRows ?? []).map((r) => [r.id as string, timeToMinutes(r.depart_time as string | null)])
  );

  const { hour: nowHour, minute: nowMinute } = kstParts(new Date(now));
  const nowMin = nowHour * 60 + nowMinute;

  for (const routeId of pendingRouteIds) {
    const ping = latestPingByRoute.get(routeId);

    if (campus && ping && (ping.accuracy == null || ping.accuracy <= DEPART_RADIUS_M)) {
      const distance = haversineMeters(campus.lat, campus.lng, ping.lat, ping.lng);
      if (distance >= DEPART_RADIUS_M) {
        const departMin = departMinByRoute.get(routeId) ?? null;
        const tooEarly = departMin != null && nowMin < departMin - DEPART_EARLIEST_BEFORE_MIN;

        if (tooEarly) {
          // 아직 하원 시각이 아닌데 학교를 벗어났습니다. 출발이 아니라 **아직 안 온 것**입니다
          // (일찍 와서 잠깐 댔다가 자리를 옮기는 중).
          //
          // 그래서 출발로 찍지 않고, 앞서 찍힌 '현장도착'을 **되돌립니다.** 그대로 두면
          // 안내보드에 차가 없는데 "도착함"으로 계속 떠 있고, 아이들이 나가버립니다.
          // 다시 학교로 들어오면 도착이 새로 찍힙니다.
          await supabase
            .from("shuttle_run_events")
            .delete()
            .eq("service_date", today)
            .eq("route_id", routeId)
            .eq("event", "현장도착")
            .eq("created_by", "GPS 자동감지"); // 사람이 누른 도착은 건드리지 않습니다.
          continue;
        }

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
