import type { SupabaseClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/shuttleTracking";
import { learnRoute, LEARN_WINDOW_DAYS, type LearnObs } from "@/lib/shuttleStopLearn";

/**
 * **정류장 좌표 재계산** — 크론과 화면의 「지금 다시 계산」이 같은 함수를 씁니다.
 *
 * 크론 안에만 두면, 사람이 정차를 정류장에 골라 준 뒤 **다음 날 운행이 있어야** 반영됩니다.
 * 고르고 나서 바로 결과를 못 보면 고른 것이 먹혔는지 알 수 없습니다.
 */
export type RelearnTarget = {
  routeId: string;
  stopsUpdated: number;
  rejected: { dayCount: number; reason: string; nearestSeq: number | null; distanceM: number | null }[];
  errors: string[];
};

/**
 * 최근 관측을 자리별로 묶어, 매일 같은 곳에 서는 자리만 정류장 좌표로 인정합니다.
 *
 * **하루치로는 정류장과 신호대기를 구별할 수 없습니다** - 신호에 걸려 60초 선 것과 정류장에서
 * 60초 선 것은 GPS만 보면 똑같이 생겼습니다. 갈리는 것은 반복성뿐입니다.
 *
 *   · 정류장  : 결석이 아니면 매일 섭니다 → 겹쳐 보면 한 자리에 모입니다.
 *   · 신호대기: 어떤 날은 서고 어떤 날은 지나갑니다 → 겹쳐 보면 흩어집니다.
 */
export async function recomputeStopCoords(supabase: SupabaseClient, results: RelearnTarget[]): Promise<void> {
  const since = kstParts(new Date(Date.now() - LEARN_WINDOW_DAYS * 24 * 60 * 60 * 1000)).iso;

  for (const result of results) {
    const routeId = result.routeId;
    const { data: obsRows, error: obsError } = await supabase
      .from("shuttle_stop_observations")
      // 사람이 고른 표시와 점 수를 함께 읽습니다. 사람이 고른 정차는 그 정류장에 그대로 들어가고,
      // 점 수는 정차 하나의 정확도(뭉친 정차 > 빈 구간 추정)로 가중하는 데 씁니다.
      .select("id, lat, lng, service_date, dwell_seconds, sample_count, matched_stop_id, assigned_by_human")
      .eq("route_id", routeId)
      .gte("service_date", since);
    if (obsError) {
      result.errors.push(`관측 조회 실패: ${obsError.message}`);
      continue;
    }
    const rows = (obsRows as LearnObs[] | null) ?? [];
    if (rows.length === 0) continue;

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

    const { verdicts, updates } = learnRoute(rows, stops);

    for (const v of verdicts) {
      const { error: markError } = await supabase
        .from("shuttle_stop_observations")
        .update({
          verdict: v.accepted ? "stop" : "transit",
          reject_reason: v.accepted ? null : v.reason,
          // 어느 정류장 학습에 쓰였는지 정차마다 남깁니다. 화면이 「이 정류장 앞에 어느 날
          // 어디 섰나」를 점으로 그리는 재료입니다. 사람이 고른 정차는 건드리지 않습니다.
          ...(v.accepted && v.stopId ? { matched_stop_id: v.stopId } : {}),
        })
        .in("id", v.obsIds)
        .eq("assigned_by_human", false);
      if (markError) result.errors.push(`판단 기록 실패: ${markError.message}`);
      if (!v.accepted) result.rejected.push({ dayCount: v.dayCount, reason: v.reason, nearestSeq: v.stopSeq, distanceM: v.distanceM });
    }

    for (const u of updates) {
      const { error } = await supabase
        .from("shuttle_stops")
        .update({
          gps_lat: u.lat,
          gps_lng: u.lng,
          gps_sample_count: u.count,
          gps_updated_at: new Date().toISOString(),
          gps_day_count: u.dayCount,
          gps_confidence: u.rate,
          gps_dwell_seconds: u.dwellAvg,
          gps_spread_m: u.spreadM,
        })
        .eq("id", u.stopId);
      if (error) result.errors.push(`정류장 좌표 갱신 실패: ${error.message}`);
      else result.stopsUpdated += 1;
    }
  }
}

