import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";

// 기사님 휴대폰에서 받은 위치 기록을 90일이 지나면 완전히 지웁니다.
//
// 왜 필요한가요?
//   기사님께 받는 동의서에 "수집일로부터 90일 뒤 자동 삭제"라고 적었습니다. 문서에만 적어두고
//   실제로는 계속 쌓아두면 그 약속이 거짓이 됩니다. 개인의 이동 경로는 민감한 정보라, 필요한
//   기간이 지나면 실제로 없어져야 합니다.
//
// 90일인 이유
//   하원 운행은 학기 단위로 돌아가고, "지난달 그 차가 몇 시에 도착했는지" 같은 확인 요청은
//   길어야 한 두 달 안에 들어옵니다. 그보다 오래 보관할 이유가 없습니다.
//
// 정류장 좌표 학습 결과(shuttle_stops.gps_lat/lng)는 지우지 않습니다 - 그건 개인의 이동 기록이
// 아니라 "이 정류장이 어디인가"라는 장소 정보이고, 원본 위치 기록에서 이미 평균만 뽑아낸 값입니다.
const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 위치 원본(기사님 휴대폰이 보낸 점 하나하나)
    const { data: pings, error: pingError } = await supabase
      .from("shuttle_pilot_pings")
      .delete()
      .lt("recorded_at", cutoff)
      .select("id");
    if (pingError) throw pingError;

    // 정차 관찰 기록(어디서 얼마나 서 있었는지) - 정류장 좌표를 학습하고 나면 원본은 필요 없습니다.
    const { data: observations, error: obsError } = await supabase
      .from("shuttle_stop_observations")
      .delete()
      .lt("arrived_at", cutoff)
      .select("id");
    if (obsError) throw obsError;

    return NextResponse.json({
      ok: true,
      retentionDays: RETENTION_DAYS,
      purgedPings: pings?.length ?? 0,
      purgedObservations: observations?.length ?? 0,
    });
  } catch (err) {
    await logApiError(supabase, "cron:purge-shuttle-locations", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
