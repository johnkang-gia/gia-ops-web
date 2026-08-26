import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { haversineMeters } from "@/lib/shuttleRecommend";
import { ensureCampusLocation } from "@/lib/shuttleCampus";
import { kstParts, shouldRunShuttleCron } from "@/lib/shuttleTracking";

// 요청: "학교근처에 오면 자동으로 도착알림이 뜨고, 출발하게 되면 출발 표시가 뜨도록" - 이미 만든
// 출발 자동감지(shuttle-auto-depart)의 짝입니다. Traccar Client가 보내오는 위치를 보고, 차량이
// 학교 반경 안에 들어와 잠시 머무르면 사람이 누르지 않아도 "현장도착"을 자동으로 기록합니다.
// 도착이 찍히면 안내보드·도착체크 화면에 그 차량이 바로 뜨고, 이어서 학교에서 멀어지는 순간
// 출발 자동감지가 "출발"을 채워 넣어 하원 한 바퀴가 조작 없이 완결됩니다.
//
// 외부 무료 스케줄러(cron-job.org 등)가 1분마다 호출하고, 그 안에서 25초 예산으로 5초마다
// 반복 검사해 실제 반영은 초 단위로 이뤄지게 합니다(poll-chat-messages와 같은 패턴).
export const maxDuration = 30;

const LOOP_BUDGET_MS = 25_000;
const LOOP_INTERVAL_MS = 5_000;

// 이보다 오래된 핑은 "지금 상황"으로 믿지 않습니다.
const PING_FRESHNESS_MS = 3 * 60 * 1000;
// 학교 위치에서 이 거리(m) 안에 들어오면 도착 후보로 봅니다(출발 감지와 같은 반경).
const ARRIVE_RADIUS_M = 100;
// 학교 앞을 그냥 지나가기만 한 경우를 걸러내려고, 반경 안 핑이 이만큼 이어져야 도착으로 봅니다.
const ARRIVE_MIN_DWELL_MS = 60 * 1000;
// 반경 안에 있었다고 인정할 최소 핑 개수(한 점이 튀어서 오탐하는 것을 막습니다).
const ARRIVE_MIN_SAMPLES = 2;

async function runAutoArrivePass(supabase: SupabaseClient): Promise<{ arrived: number }> {
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
  const { data: devices } = await supabase.from("shuttle_tracker_devices").select("route_id").eq("enabled", true);
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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 운행 시간대 밖이면 루프에 들어가지 않고 바로 돌아섭니다.
  //
  // 이 크론은 1분마다 불리고 한 번에 25초 동안 함수를 붙잡습니다. 차가 다니는 시간은 하루
  // 3시간뿐인데 24시간 내내 그렇게 돌아서, 이것 하나가 월 300시간을 썼습니다. 창 밖에는
  // 애초에 볼 위치 자체가 저장되지 않으므로(/api/shuttle/track이 버립니다) 없는 데이터를
  // 5초마다 다시 확인하고 있었던 셈입니다.
  if (!shouldRunShuttleCron()) {
    return NextResponse.json({ ok: true, skipped: "out_of_service_window" });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const startedAt = Date.now();
  let rounds = 0;
  let totalArrived = 0;
  let lastError: string | null = null;

  while (Date.now() - startedAt < LOOP_BUDGET_MS) {
    rounds += 1;
    try {
      const { arrived } = await runAutoArrivePass(supabase);
      totalArrived += arrived;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await logApiError(supabase, "cron:shuttle-auto-arrive", err);
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= LOOP_BUDGET_MS) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(LOOP_INTERVAL_MS, LOOP_BUDGET_MS - elapsed)));
  }

  return NextResponse.json({ ok: true, rounds, arrived: totalArrived, lastError });
}
