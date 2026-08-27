import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { shouldRunShuttleCron } from "@/lib/shuttleTracking";
import { runAutoArrivePass, runAutoDepartPass } from "@/lib/shuttleAuto";
import { touchHeartbeat } from "@/lib/heartbeat";

// 하원 셔틀 자동 도착·출발 감지 — 하나로 합친 크론.
//
// 예전에는 /api/cron/shuttle-auto-arrive 와 /api/cron/shuttle-auto-depart 가 따로 있었고,
// 외부 스케줄러가 **둘 다** 1분마다 불렀습니다. 그런데 두 판단은 같은 시각에 같은 표를 보고
// 이뤄집니다 - 오늘 어느 노선이 도착했는지(shuttle_run_events)를 각자 한 번씩 조회했고,
// 각자 25초씩 함수를 붙잡았습니다. 한 번 조회해 둘 다 판단하면 될 일을 두 번 하고 있었습니다.
//
// 여기서 한 루프 안에 도착 → 출발 순서로 처리합니다. 순서가 중요합니다: 방금 도착으로 찍힌
// 노선이 같은 회차에서 출발 후보로 넘어가야, 도착과 출발 사이 간격이 정확히 재집니다.
//
// 외부 스케줄러(cron-job.org) 설정을 이 주소 하나로 바꾸고 예전 두 개는 지워주세요.
// 예전 라우트는 당분간 그대로 두되 "여기로 옮겼습니다"만 알려주고 아무 일도 하지 않습니다.
export const maxDuration = 30;

// cron-job.org 무료 플랜의 요청 타임아웃이 30초라 5초 여유를 둡니다.
const LOOP_BUDGET_MS = 25_000;
const LOOP_INTERVAL_MS = 5_000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 운행 시간대 밖이면 루프에 들어가지 않고 바로 돌아섭니다. 창 밖에는 애초에 볼 위치 자체가
  // 저장되지 않으므로(/api/shuttle/track이 버립니다) 없는 데이터를 다시 확인할 이유가 없습니다.
  if (!shouldRunShuttleCron()) {
    return NextResponse.json({ ok: true, skipped: "out_of_service_window" });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const startedAt = Date.now();
  let arrived = 0;
  let gpsDeparted = 0;
  let timeoutDeparted = 0;
  let rounds = 0;
  let lastError: string | null = null;

  while (Date.now() - startedAt < LOOP_BUDGET_MS) {
    rounds += 1;
    try {
      // 도착을 먼저 찍어야 그 노선이 출발 후보가 됩니다.
      arrived += (await runAutoArrivePass(supabase)).arrived;
      const d = await runAutoDepartPass(supabase);
      gpsDeparted += d.gpsDeparted;
      timeoutDeparted += d.timeoutDeparted;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await logApiError(supabase, "cron:shuttle-auto", err);
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= LOOP_BUDGET_MS) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(LOOP_INTERVAL_MS, LOOP_BUDGET_MS - elapsed)));
  }

  await touchHeartbeat(supabase, "cron:shuttle-auto");
  return NextResponse.json({ ok: true, rounds, arrived, gpsDeparted, timeoutDeparted, lastError });
}
