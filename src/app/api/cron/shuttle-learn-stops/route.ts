import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { haversineMeters } from "@/lib/shuttleRecommend";
import { ensureCampusLocation } from "@/lib/shuttleCampus";
import { kstParts, isWithinTrackingWindow } from "@/lib/shuttleTracking";

// 요청: "각 정류장도 우리는 지금 정확한 정보를 가지고 있지 않아서, gps를 통해서 정류장과, 도착
// 또한 gps를 계속 갱신해서 정확도를 높여서 정류장도 파악이 되도록 만들어줘"
//
// 정류장 좌표는 지금 주소 지오코딩 결과라서, 실제로 차가 서는 자리(아파트 후문, 상가 앞 등)와
// 수십~수백 미터씩 차이가 납니다. 이 크론은 그날 실제 주행 기록(shuttle_pilot_pings)에서 "차가
// 실제로 멈춰 있던 지점"을 찾아내 기록하고, 같은 자리가 며칠 반복해서 관측될수록 평균 좌표를
// 갱신해 정확도를 올립니다. 관측만 쌓아둘 뿐 기존 정류장 좌표를 마음대로 덮어쓰지는 않고,
// 담당자가 관리자 화면에서 확인한 뒤 반영하도록 gps_* 칼럼에 따로 담습니다.
//
// 하루 한두 번만 돌면 충분해서 Vercel의 일일 크론(vercel.json)으로 돌려도 되고, 기존 외부
// 스케줄러에 하루 한 번 등록해도 됩니다.
export const maxDuration = 60;

// 이 반경(m) 안에 이어지는 핑들을 "같은 자리에 멈춰 있던 것"으로 묶습니다.
const DWELL_RADIUS_M = 35;
// 그 자리에 최소한 이만큼(초) 머물러야 정차로 인정합니다(신호 대기와 구분).
const DWELL_MIN_SEC = 45;
// 점 하나가 튀어서 생기는 가짜 정차를 막기 위한 최소 핑 개수.
const DWELL_MIN_SAMPLES = 3;
// 학교 근처 정차는 정류장이 아니라 승하차 지점이므로 제외합니다.
const CAMPUS_EXCLUDE_M = 150;
// 관측된 정차 지점을 기존 정류장에 연결할 때 인정하는 최대 거리(m). 기존 좌표 자체가 부정확한
// 상태라 넉넉하게 잡고, 이 안에 없으면 "미매칭"으로 남겨 담당자가 직접 지정하게 합니다.
const MATCH_RADIUS_M = 400;
// 속도 정보가 있을 때(Traccar), 이 속도(km/h)보다 빠른 핑은 정차로 보지 않습니다.
const STOPPED_SPEED_KMH = 5;

type Ping = { lat: number; lng: number; speed: number | null; recorded_at: string };
type Dwell = { lat: number; lng: number; startAt: string; endAt: string; seconds: number; samples: number };

// 두 핑 사이가 이만큼(초) 넘게 비어 있으면 "그 사이에 서 있었다"고 봅니다.
// 앱에 거리 필터(Distance)를 걸면 차가 멈춘 동안에는 위치를 아예 보내지 않으므로, 정차는
// 점이 쌓이는 모습이 아니라 '기록이 비는 모습'으로 나타납니다.
const GAP_MIN_SEC = 45;
// 그 빈 구간의 앞뒤 점이 이 거리(m) 안이어야 정차로 인정합니다. 멀리 떨어져 있으면 서 있었던
// 게 아니라 신호가 끊긴 채로 달린 것(터널·음영지역)입니다.
//
// 400m인 이유: 차가 다시 출발하면 앱은 다음 확인 시각(30초)에 위치를 보냅니다. 그 30초 동안
// 시속 40km면 이미 330m를 갑니다 - 즉 "정차 직전 점"과 "출발 후 첫 점"은 정상적으로도 300m
// 넘게 벌어집니다. 이보다 좁게 잡으면 실제 정차를 통째로 놓칩니다(처음에 150m로 뒀다가
// 모의 데이터에서 정차를 하나도 못 잡는 것을 확인하고 고쳤습니다).
const GAP_MAX_MOVE_M = 400;
// 빈 구간 직전 점의 속도가 이보다 빠르면 정차로 보지 않습니다. 정류장에 서려는 차는 이미
// 속도를 줄이고 있고, 달리다가 기록이 끊긴 것(터널)은 속도가 그대로 높습니다.
const GAP_MAX_APPROACH_KMH = 30;

// 연속된 핑을 훑으면서 "한 자리에 머문 구간"을 찾습니다.
//
// 두 가지 모습을 모두 잡습니다 - 앱 설정이 어느 쪽이든 정류장 학습이 끊기지 않아야 하기 때문입니다.
//
//  ① 점이 뭉치는 모습(거리 필터 없음): 멈춰 있는 동안에도 30초마다 같은 자리 점이 쌓입니다.
//     예전부터 쓰던 방식이고, 여러 점을 평균 내므로 좌표가 가장 정확합니다.
//  ② 기록이 비는 모습(거리 필터 있음): 멈춰 있는 동안 전송이 없어 점 사이가 훌쩍 벌어집니다.
//     이때는 빈 구간 직전의 점을 정차 지점으로 씁니다(거리 필터 값만큼의 오차 안에 있습니다).
//
// ②를 함께 보는 이유: 기사님 휴대폰이 하루 종일 30초마다 위치를 보내면 서버 호출이 한 달에
// 300만 건을 넘습니다. 거리 필터를 걸면 그게 17만 건으로 줄지만, ①만 볼 줄 알면 그 순간
// 정류장 학습이 통째로 죽습니다(멈춰 있을 때 점이 없으니까요). 그래서 먼저 ②를 붙여둡니다.
function detectDwells(pings: Ping[]): Dwell[] {
  const dwells: Dwell[] = [];
  let group: Ping[] = [];

  function flush() {
    if (group.length >= DWELL_MIN_SAMPLES) {
      const startAt = group[0].recorded_at;
      const endAt = group[group.length - 1].recorded_at;
      const seconds = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000;
      if (seconds >= DWELL_MIN_SEC) {
        const lat = group.reduce((sum, p) => sum + p.lat, 0) / group.length;
        const lng = group.reduce((sum, p) => sum + p.lng, 0) / group.length;
        dwells.push({ lat, lng, startAt, endAt, seconds: Math.round(seconds), samples: group.length });
      }
    }
    group = [];
  }

  for (let i = 0; i < pings.length; i += 1) {
    const ping = pings[i];

    // ② 기록이 비는 모습 - 이 점과 다음 점 사이가 오래 비었고 그동안 거의 안 움직였다면 정차.
    const next = pings[i + 1];
    if (next) {
      const gapSec = (new Date(next.recorded_at).getTime() - new Date(ping.recorded_at).getTime()) / 1000;
      const moved = haversineMeters(ping.lat, ping.lng, next.lat, next.lng);
      const slowingDown = ping.speed == null || ping.speed <= GAP_MAX_APPROACH_KMH;
      if (gapSec >= GAP_MIN_SEC && moved <= GAP_MAX_MOVE_M && slowingDown) {
        // 뭉쳐 있던 점이 있으면 그쪽을 먼저 닫습니다(같은 정차를 두 번 세지 않도록).
        const already = group.length >= DWELL_MIN_SAMPLES;
        flush();
        if (!already) {
          dwells.push({
            lat: ping.lat,
            lng: ping.lng,
            startAt: ping.recorded_at,
            endAt: next.recorded_at,
            seconds: Math.round(gapSec),
            // 점 하나로 추정한 정차라는 표시(뭉친 정차는 3 이상). 화면에서 신뢰도로 씁니다.
            samples: 1,
          });
        }
        continue;
      }
    }

    // ① 점이 뭉치는 모습 - 속도를 알 수 있으면 달리는 중인 핑은 아예 후보에서 뺍니다.
    if (ping.speed != null && ping.speed > STOPPED_SPEED_KMH) {
      flush();
      continue;
    }
    if (group.length === 0) {
      group.push(ping);
      continue;
    }
    const centerLat = group.reduce((sum, p) => sum + p.lat, 0) / group.length;
    const centerLng = group.reduce((sum, p) => sum + p.lng, 0) / group.length;
    if (haversineMeters(centerLat, centerLng, ping.lat, ping.lng) <= DWELL_RADIUS_M) {
      group.push(ping);
    } else {
      flush();
      group.push(ping);
    }
  }
  flush();
  return dwells;
}

async function learnForDate(supabase: SupabaseClient, serviceDate: string): Promise<{ observed: number; stopsUpdated: number }> {
  const { data: devices } = await supabase.from("shuttle_tracker_devices").select("route_id").eq("enabled", true);
  const routeIds = [...new Set((devices ?? []).map((d) => d.route_id))];
  if (routeIds.length === 0) return { observed: 0, stopsUpdated: 0 };

  const campus = await ensureCampusLocation(supabase);
  const dayStart = new Date(`${serviceDate}T00:00:00+09:00`).toISOString();
  const dayEnd = new Date(`${serviceDate}T23:59:59+09:00`).toISOString();

  const { data: stops } = await supabase.from("shuttle_stops").select("id, route_id, seq, lat, lng").in("route_id", routeIds);
  const stopsByRoute = new Map<string, { id: string; seq: number; lat: number | null; lng: number | null }[]>();
  for (const s of stops ?? []) {
    const list = stopsByRoute.get(s.route_id) ?? [];
    list.push({ id: s.id, seq: s.seq, lat: s.lat, lng: s.lng });
    stopsByRoute.set(s.route_id, list);
  }

  let observed = 0;
  const touchedStopIds = new Set<string>();

  for (const routeId of routeIds) {
    const { data: allPings } = await supabase
      .from("shuttle_pilot_pings")
      .select("lat, lng, speed, recorded_at")
      .eq("route_id", routeId)
      .gte("recorded_at", dayStart)
      .lte("recorded_at", dayEnd)
      .order("recorded_at", { ascending: true });

    // 하원 운행 시간대(평일 15:30~18:30)의 기록만 씁니다.
    //
    // 보통 기기는 시간대 밖 위치를 애초에 저장하지 않아 이 걸러내기가 표시나지 않습니다. 문제는
    // [24h 테스트]를 켜둔 기기입니다 - 그 기기는 하루 종일 저장되기 때문에, 담당자의 출퇴근길
    // 신호대기·집·사무실 주차가 전부 '정차'로 잡히고, 그 자리가 어느 정류장 반경 400m 안에
    // 들어가면 그 정류장의 학습 좌표 평균까지 끌고 갑니다. 실제로 정류장이 엉뚱한 곳으로
    // 옮겨갈 수 있는 오염이라, 학습에 쓰는 기록은 운행 시간대로 못 박습니다.
    const pings = (allPings ?? []).filter((p) => isWithinTrackingWindow(new Date(p.recorded_at as string)));
    if (pings.length < DWELL_MIN_SAMPLES) continue;

    const dwells = detectDwells(pings as Ping[]).filter(
      (d) => !campus || haversineMeters(campus.lat, campus.lng, d.lat, d.lng) > CAMPUS_EXCLUDE_M
    );
    if (dwells.length === 0) continue;

    const routeStops = (stopsByRoute.get(routeId) ?? []).filter((s) => s.lat != null && s.lng != null);

    for (let i = 0; i < dwells.length; i += 1) {
      const dwell = dwells[i];
      let matchedStopId: string | null = null;
      let matchedDistance: number | null = null;
      for (const stop of routeStops) {
        const distance = haversineMeters(stop.lat as number, stop.lng as number, dwell.lat, dwell.lng);
        if (distance <= MATCH_RADIUS_M && (matchedDistance == null || distance < matchedDistance)) {
          matchedStopId = stop.id;
          matchedDistance = distance;
        }
      }

      // 같은 정차 시작 시각은 한 번만 기록되도록 DB에 유니크 인덱스를 걸어뒀습니다 - 크론이
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
        observed += 1;
        if (matchedStopId) touchedStopIds.add(matchedStopId);
      }
    }
  }

  // 관측이 새로 들어온 정류장은 지금까지의 모든 관측을 평균 내어 gps_* 값을 다시 계산합니다
  // (매번 전체를 다시 계산하므로 크론이 몇 번 돌든 결과가 같습니다).
  let stopsUpdated = 0;
  for (const stopId of touchedStopIds) {
    const { data: rows } = await supabase.from("shuttle_stop_observations").select("lat, lng").eq("matched_stop_id", stopId);
    if (!rows || rows.length === 0) continue;
    const lat = rows.reduce((sum, r) => sum + r.lat, 0) / rows.length;
    const lng = rows.reduce((sum, r) => sum + r.lng, 0) / rows.length;
    const { error } = await supabase
      .from("shuttle_stops")
      .update({ gps_lat: lat, gps_lng: lng, gps_sample_count: rows.length, gps_updated_at: new Date().toISOString() })
      .eq("id", stopId);
    if (!error) stopsUpdated += 1;
  }

  return { observed, stopsUpdated };
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

  // 오늘과 어제를 함께 훑습니다 - 늦은 시간에 돌든 다음날 새벽에 돌든 빠지는 날이 없도록.
  const todayKst = kstParts(new Date()).iso;
  const yesterdayKst = kstParts(new Date(Date.now() - 24 * 60 * 60 * 1000)).iso;

  let observed = 0;
  let stopsUpdated = 0;
  let lastError: string | null = null;
  for (const serviceDate of [yesterdayKst, todayKst]) {
    try {
      const result = await learnForDate(supabase, serviceDate);
      observed += result.observed;
      stopsUpdated += result.stopsUpdated;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await logApiError(supabase, "cron:shuttle-learn-stops", err);
    }
  }

  return NextResponse.json({ ok: true, observed, stopsUpdated, lastError });
}
