import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { haversineMeters } from "@/lib/shuttleRecommend";
import { ensureCampusLocation } from "@/lib/shuttleCampus";
import { kstParts, isWithinTrackingWindow } from "@/lib/shuttleTracking";
import { touchHeartbeat } from "@/lib/heartbeat";
import {
  detectDwells,
  groupIntoPlaces,
  matchPlacesToStops,
  CAMPUS_EXCLUDE_M,
  DWELL_MIN_SAMPLES,
  LEARN_WINDOW_DAYS,
  MATCH_RADIUS_M,
  type Obs,
  type Ping,
} from "@/lib/shuttleStopLearn";

// 정류장 좌표는 주소 지오코딩 결과라서, 실제로 차가 서는 자리(아파트 후문·상가 앞)와 수십~수백
// 미터씩 차이가 납니다. 이 크론은 그날 실제 주행 기록(shuttle_pilot_pings)에서 「차가 실제로
// 멈춰 있던 지점」을 찾아 기록하고, 같은 자리가 며칠 반복될수록 평균 좌표를 갱신해 정확도를
// 올립니다. 기존 좌표를 마음대로 덮어쓰지 않고 gps_* 칸에 따로 담아, 담당자가 화면에서 확인한
// 뒤 반영합니다.
//
// ── 계산은 여기 없습니다 ────────────────────────────────────────────────────
//
// 정차 감지·묶기·판정은 `src/lib/shuttleStopLearn.ts` 에 있습니다. 이 파일 안에 있을 때는
// 화면이 같은 판단을 다시 만들 수 없어서, 「왜 이 정류장은 학습이 안 됐는가」가 어디에도
// 남지 않았습니다.
export const maxDuration = 60;

type RouteResult = {
  routeId: string;
  pings: number;
  dwells: number;
  inserted: number;
  duplicated: number;
  stopsUpdated: number;
  /** 관측은 있는데 정류장으로 인정 못 한 자리와 그 이유. 화면·로그에 그대로 나갑니다. */
  rejected: { dayCount: number; reason: string; nearestSeq: number | null; distanceM: number | null }[];
  errors: string[];
};

async function learnForDate(supabase: SupabaseClient, serviceDate: string, routeIds: string[]): Promise<RouteResult[]> {
  const campus = await ensureCampusLocation(supabase);
  const dayStart = new Date(`${serviceDate}T00:00:00+09:00`).toISOString();
  const dayEnd = new Date(`${serviceDate}T23:59:59+09:00`).toISOString();

  // 그날 위치가 하나라도 들어온 노선만 봅니다.
  //
  // 예전에는 등록된 기기 49대의 노선을 전부 돌면서 한 노선씩 위치를 조회했습니다. 실제로
  // 신호가 오는 노선은 2개뿐이라 47번은 빈 조회였고, 그 왕복만으로 60초 제한에 가까워졌습니다.
  // 시간이 모자라 함수가 끊기면 뒤쪽 노선은 그날 학습이 통째로 빠지는데, 화면에는 아무 표시도
  // 남지 않습니다.
  const { data: allPings, error: pingError } = await supabase
    .from("shuttle_pilot_pings")
    .select("route_id, lat, lng, speed, recorded_at")
    .in("route_id", routeIds)
    .gte("recorded_at", dayStart)
    .lte("recorded_at", dayEnd)
    .order("recorded_at", { ascending: true });
  if (pingError) throw new Error(`위치 기록 조회 실패: ${pingError.message}`);

  const pingsByRoute = new Map<string, Ping[]>();
  for (const p of allPings ?? []) {
    // 하원 운행 시간대(평일 15:30~18:30)의 기록만 씁니다.
    //
    // [24h 테스트]를 켜둔 기기는 하루 종일 저장되기 때문에, 담당자의 출퇴근길 신호대기·집·
    // 사무실 주차가 전부 정차로 잡히고, 그 자리가 어느 정류장 반경 안에 들어가면 그 정류장의
    // 학습 좌표를 끌고 갑니다.
    if (!isWithinTrackingWindow(new Date(p.recorded_at as string))) continue;
    const key = p.route_id as string;
    const list = pingsByRoute.get(key) ?? [];
    list.push({ lat: p.lat as number, lng: p.lng as number, speed: (p.speed as number | null) ?? null, recorded_at: p.recorded_at as string });
    pingsByRoute.set(key, list);
  }

  const activeRoutes = [...pingsByRoute.keys()];
  if (activeRoutes.length === 0) return [];

  const { data: stops, error: stopError } = await supabase
    .from("shuttle_stops")
    .select("id, route_id, seq, lat, lng, gps_lat, gps_lng")
    .in("route_id", activeRoutes);
  if (stopError) throw new Error(`정류장 조회 실패: ${stopError.message}`);

  type StopRow = { id: string; route_id: string; seq: number; lat: number | null; lng: number | null; gps_lat: number | null; gps_lng: number | null };
  const stopsByRoute = new Map<string, StopRow[]>();
  for (const s of (stops ?? []) as StopRow[]) {
    const list = stopsByRoute.get(s.route_id) ?? [];
    list.push(s);
    stopsByRoute.set(s.route_id, list);
  }

  const results: RouteResult[] = [];

  for (const routeId of activeRoutes) {
    const pings = pingsByRoute.get(routeId) ?? [];
    const result: RouteResult = {
      routeId,
      pings: pings.length,
      dwells: 0,
      inserted: 0,
      duplicated: 0,
      stopsUpdated: 0,
      rejected: [],
      errors: [],
    };
    results.push(result);
    if (pings.length < DWELL_MIN_SAMPLES) continue;

    const dwells = detectDwells(pings).filter((d) => !campus || haversineMeters(campus.lat, campus.lng, d.lat, d.lng) > CAMPUS_EXCLUDE_M);
    result.dwells = dwells.length;
    if (dwells.length === 0) continue;

    // 정류장 좌표는 학습값(gps_*)이 있으면 그쪽이 더 정확합니다.
    const routeStops = (stopsByRoute.get(routeId) ?? []).map((s) => ({
      id: s.id,
      seq: s.seq,
      lat: s.gps_lat ?? s.lat,
      lng: s.gps_lng ?? s.lng,
    }));
    const placed = routeStops.filter((s) => s.lat != null && s.lng != null);

    for (let i = 0; i < dwells.length; i += 1) {
      const dwell = dwells[i];
      let matchedStopId: string | null = null;
      let matchedDistance: number | null = null;
      for (const stop of placed) {
        const distance = haversineMeters(stop.lat as number, stop.lng as number, dwell.lat, dwell.lng);
        if (distance <= MATCH_RADIUS_M && (matchedDistance == null || distance < matchedDistance)) {
          matchedStopId = stop.id;
          matchedDistance = distance;
        }
      }

      // 같은 정차 시작 시각은 한 번만 기록되도록 DB에 유니크 색인을 걸어뒀습니다 - 크론이
      // 여러 번 돌아도 관측이 중복으로 쌓이지 않습니다.
      const { error } = await supabase.from("shuttle_stop_observations").insert({
        route_id: routeId,
        service_date: serviceDate,
        lat: dwell.lat,
        lng: dwell.lng,
        arrived_at: dwell.startAt,
        departed_at: dwell.endAt,
        dwell_seconds: dwell.seconds,
        sample_count: dwell.samples,
        order_index: i + 1,
        matched_stop_id: matchedStopId,
        distance_m: matchedDistance,
      });
      if (!error) {
        result.inserted += 1;
      } else if (error.code === "23505") {
        // 이미 기록된 정차. 크론이 두 번 돌면 정상적으로 나옵니다.
        result.duplicated += 1;
      } else {
        // 조용히 넘기지 않습니다. 관측이 안 쌓이면 학습은 영원히 멈추는데, 예전에는 이
        // 오류를 버려서 화면에는 「관측이 없다」로만 보였습니다.
        result.errors.push(`관측 저장 실패: ${error.message}`);
      }
    }
  }

  return results;
}

/**
 * 최근 관측을 자리별로 묶어, 매일 같은 곳에 서는 자리만 정류장 좌표로 인정합니다.
 *
 * **하루치로는 정류장과 신호대기를 구별할 수 없습니다** - 신호에 걸려 60초 선 것과 정류장에서
 * 60초 선 것은 GPS만 보면 똑같이 생겼습니다. 갈리는 것은 반복성뿐입니다.
 *
 *   · 정류장  : 결석이 아니면 매일 섭니다 → 겹쳐 보면 한 자리에 모입니다.
 *   · 신호대기: 어떤 날은 서고 어떤 날은 지나갑니다 → 겹쳐 보면 흩어집니다.
 */
async function recomputeStopCoords(supabase: SupabaseClient, results: RouteResult[]): Promise<void> {
  const since = kstParts(new Date(Date.now() - LEARN_WINDOW_DAYS * 24 * 60 * 60 * 1000)).iso;

  for (const result of results) {
    const routeId = result.routeId;
    const { data: obsRows, error: obsError } = await supabase
      .from("shuttle_stop_observations")
      .select("id, lat, lng, service_date, dwell_seconds")
      .eq("route_id", routeId)
      .gte("service_date", since);
    if (obsError) {
      result.errors.push(`관측 조회 실패: ${obsError.message}`);
      continue;
    }
    const rows = (obsRows as Obs[] | null) ?? [];
    if (rows.length === 0) continue;

    // 운행한 날 = 관측이 하나라도 있는 날. 방학·주말처럼 안 다닌 날이 분모에 섞이면 모든
    // 정류장의 비율이 낮게 나와 아무것도 인정되지 않습니다.
    const runDays = new Set(rows.map((r) => r.service_date)).size;

    const { data: stopRows, error: stopError } = await supabase
      .from("shuttle_stops")
      .select("id, seq, lat, lng, gps_lat, gps_lng")
      .eq("route_id", routeId);
    if (stopError) {
      result.errors.push(`정류장 조회 실패: ${stopError.message}`);
      continue;
    }
    type Row = { id: string; seq: number; lat: number | null; lng: number | null; gps_lat: number | null; gps_lng: number | null };
    const stops = ((stopRows as Row[] | null) ?? []).map((s) => ({ id: s.id, seq: s.seq, lat: s.gps_lat ?? s.lat, lng: s.gps_lng ?? s.lng }));

    const verdicts = matchPlacesToStops(groupIntoPlaces(rows), runDays, stops);

    for (const v of verdicts) {
      // 판단 결과를 관측에 남겨, 화면에서 「왜 제외됐는지」를 볼 수 있게 합니다.
      const { error: markError } = await supabase
        .from("shuttle_stop_observations")
        .update({ verdict: v.accepted ? "stop" : "transit", reject_reason: v.accepted ? null : v.reason })
        .in("id", v.obsIds);
      if (markError) result.errors.push(`판단 기록 실패: ${markError.message}`);

      if (!v.accepted || !v.stopId) {
        result.rejected.push({ dayCount: v.dayCount, reason: v.reason, nearestSeq: v.stopSeq, distanceM: v.distanceM });
        continue;
      }

      const { error } = await supabase
        .from("shuttle_stops")
        .update({
          gps_lat: v.lat,
          gps_lng: v.lng,
          gps_sample_count: v.count,
          gps_updated_at: new Date().toISOString(),
          gps_day_count: v.dayCount,
          gps_confidence: v.rate,
          gps_dwell_seconds: v.dwellAvg,
        })
        .eq("id", v.stopId);
      if (error) result.errors.push(`정류장 좌표 갱신 실패(seq ${v.stopSeq}): ${error.message}`);
      else result.stopsUpdated += 1;
    }
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: devices, error: deviceError } = await supabase.from("shuttle_tracker_devices").select("route_id").eq("enabled", true);
  if (deviceError) return NextResponse.json({ error: `기기 조회 실패: ${deviceError.message}` }, { status: 500 });
  const routeIds = [...new Set((devices ?? []).map((d) => d.route_id as string))];
  if (routeIds.length === 0) {
    await touchHeartbeat(supabase, "cron:shuttle-learn-stops");
    return NextResponse.json({ ok: true, note: "GPS 기기가 등록된 노선이 없습니다.", routes: [] });
  }

  // 오늘과 어제를 함께 훑습니다 - 늦은 시간에 돌든 다음날 새벽에 돌든 빠지는 날이 없도록.
  const todayKst = kstParts(new Date()).iso;
  const yesterdayKst = kstParts(new Date(Date.now() - 24 * 60 * 60 * 1000)).iso;

  const byRoute = new Map<string, RouteResult>();
  const errors: string[] = [];

  for (const serviceDate of [yesterdayKst, todayKst]) {
    try {
      for (const r of await learnForDate(supabase, serviceDate, routeIds)) {
        const prev = byRoute.get(r.routeId);
        if (!prev) byRoute.set(r.routeId, r);
        else {
          prev.pings += r.pings;
          prev.dwells += r.dwells;
          prev.inserted += r.inserted;
          prev.duplicated += r.duplicated;
          prev.errors.push(...r.errors);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${serviceDate}: ${message}`);
      await logApiError(supabase, "cron:shuttle-learn-stops", err);
    }
  }

  const results = [...byRoute.values()];
  try {
    await recomputeStopCoords(supabase, results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`좌표 재계산: ${message}`);
    await logApiError(supabase, "cron:shuttle-learn-stops", err);
  }

  for (const r of results) errors.push(...r.errors);
  await touchHeartbeat(supabase, "cron:shuttle-learn-stops");

  return NextResponse.json({
    ok: errors.length === 0,
    기기등록노선: routeIds.length,
    위치들어온노선: results.length,
    관측저장: results.reduce((n, r) => n + r.inserted, 0),
    정류장갱신: results.reduce((n, r) => n + r.stopsUpdated, 0),
    routes: results,
    errors,
  });
}
