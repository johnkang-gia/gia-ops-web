import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { haversineMeters } from "@/lib/shuttleRecommend";
import { ensureCampusLocation } from "@/lib/shuttleCampus";

// 요청: "여러대가 한꺼번에 도착해서 그 아이들을 차로 인계하고 태우다보면, 출발하는 것을
// 체크하는걸 까먹거나, 늦어져서 계속 화면에 차량이 뜨는 경우가 너무 많아" - 교직원 도착체크
// 화면(/shuttle-arrival)은 "도착함"/"출발함"을 사람이 직접 눌러야 하는데, 하원 시간에 여러
// 차량을 동시에 상대하다 보면 "출발" 누르는 걸 잊어버려 안내보드·도착체크 화면에 이미 떠난
// 차량이 계속 남아있는 문제가 있었습니다. 이 크론이 두 가지 신호로 자동으로 "출발"을 채워
// 넣습니다:
//   1) GPS: 그 노선의 파일럿(GPS) 체크인이 켜져 있으면(shuttle_pilot_pings), 학교 위치에서
//      100m 이상 멀어진 최근 위치가 있으면 실제로 떠난 것으로 보고 자동 "출발" 처리합니다.
//   2) 시간: GPS 핑이 아예 없는 노선(기사님/동승선생님이 파일럿 링크를 안 켠 경우)은, "도착함"
//      후 20분이 지나도 "출발"이 안 눌리면 화면 정리 차원에서 자동 "출발" 처리합니다(실제로
//      떠났는지 확인된 건 아니라서 created_by에 "GPS 자동감지"와 다르게 표시합니다).
// 외부 무료 스케줄러(cron-job.org 등, poll-chat-messages와 같은 패턴)가 1분마다 이 라우트를
// 호출하고, 그 안에서 25초 예산으로 5초마다 여러 번 반복 검사해 실제 반영은 초 단위로
// 이뤄지게 합니다.
export const maxDuration = 30;

const LOOP_BUDGET_MS = 25_000;
const LOOP_INTERVAL_MS = 5_000;

// GPS 핑 하나가 "지금 상황을 보여준다"고 믿을 수 있는 최대 나이(이보다 오래된 핑은 무시).
const PING_FRESHNESS_MS = 3 * 60 * 1000;
// 도착 찍은 직후 곧바로 자동 출발되지 않도록 최소한 이만큼은 기다립니다(핸들 도중 GPS가
// 잠깐 튀어도 오작동하지 않도록 하는 안전장치).
const MIN_DWELL_MS = 90 * 1000;
// 학교 위치에서 이 거리(m) 이상 멀어진 GPS 핑이 있으면 "출발"로 봅니다.
const DEPART_RADIUS_M = 100;
// GPS 핑이 아예 없는 노선을 위한 시간 기반 안전장치(분).
const TIME_FALLBACK_MIN = 20;

async function runAutoDepartPass(supabase: SupabaseClient): Promise<{ gpsDeparted: number; timeoutDeparted: number }> {
  const today = new Date().toISOString().slice(0, 10);
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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const startedAt = Date.now();
  let rounds = 0;
  let totalGps = 0;
  let totalTimeout = 0;
  let lastError: string | null = null;

  while (Date.now() - startedAt < LOOP_BUDGET_MS) {
    rounds += 1;
    try {
      const { gpsDeparted, timeoutDeparted } = await runAutoDepartPass(supabase);
      totalGps += gpsDeparted;
      totalTimeout += timeoutDeparted;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await logApiError(supabase, "cron:shuttle-auto-depart", err);
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= LOOP_BUDGET_MS) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(LOOP_INTERVAL_MS, LOOP_BUDGET_MS - elapsed)));
  }

  return NextResponse.json({ ok: true, rounds, gpsDeparted: totalGps, timeoutDeparted: totalTimeout, lastError });
}
