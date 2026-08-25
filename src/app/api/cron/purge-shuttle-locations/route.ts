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

// 픽업 연락의 원문은 더 짧게 둡니다. 위치와 달리 "지난달 그 차가 몇 시에 도착했나" 같은 확인
// 용도가 없고, 학부모가 쓴 문장 그대로라 더 민감합니다. 30일이면 그달의 착오를 되짚기에 충분합니다.
const PICKUP_TEXT_RETENTION_DAYS = 30;

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

    // 픽업 연락의 원문(학부모가 보낸 문장)도 함께 지웁니다.
    //
    // 픽업 인박스는 학부모 대화를 쌓아두는 시스템이 아닙니다. 픽업이 아니라고 판단된 메시지는
    // 애초에 본문을 저장하지 않고, 픽업 건의 본문도 여기서 기간이 지나면 비웁니다. 행을 통째로
    // 지우지 않고 본문만 비우는 이유는, 같은 메시지를 다시 읽어 또 AI에 보내는 일을 막는
    // 표시(출처 식별자)는 남아 있어야 하기 때문입니다.
    const textCutoff = new Date(Date.now() - PICKUP_TEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: purgedTexts, error: pickupError } = await supabase
      .from("pickup_requests")
      .update({ raw_text: null })
      .lt("received_at", textCutoff)
      .not("raw_text", "is", null)
      .select("id");
    if (pickupError) throw pickupError;

    // ── 기록만 쌓이고 아무도 지우지 않던 표들 ──────────────────────────────────
    //
    // 위치·정차 기록에는 보관 기간이 있었는데, 운영하며 늘어난 아래 표들에는 없었습니다.
    // Supabase 무료 플랜 데이터베이스는 500MB가 상한이고, 이 표들은 하루도 쉬지 않고 행이
    // 늘어납니다(운행 이벤트는 노선 38개 × 매일, AI 사용기록은 호출마다 한 줄). 그대로 두면
    // 언젠가 학생 명부를 넣을 자리가 없어서 저장이 실패합니다.
    //
    // 기간은 "그 기록을 되짚어 볼 일이 실제로 남아 있는 기간"으로 잡았습니다.
    //   운행 이벤트·안전운행  90일 - 위치 기록과 같은 주기(그 기록들과 짝을 이루는 자료)
    //   AI 사용기록          90일 - 한 분기 비용 추이를 보면 충분
    //   오류 로그            30일 - 한 달 지난 오류는 이미 고쳤거나 재현되지 않습니다
    //   구글챗 미러링        180일 - 한 학기치. 원본은 구글챗에 그대로 남아 있습니다
    const cutoff90 = cutoff; // 위와 같은 90일 기준
    const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

    // 표가 아직 없거나(마이그레이션 전) 칸 이름이 다른 경우에도 크론 전체가 실패하지 않도록
    // 한 건씩 따로 감쌉니다 - 하나가 안 지워진다고 나머지까지 안 지워지면 안 됩니다.
    async function purge(table: string, column: string, cutoffIso: string): Promise<number> {
      try {
        const { data, error } = await supabase.from(table).delete().lt(column, cutoffIso).select("id");
        if (error) return 0;
        return data?.length ?? 0;
      } catch {
        return 0;
      }
    }

    const [runEvents, safetyEvents, aiLogs, errorLogs, mirrored] = await Promise.all([
      purge("shuttle_run_events", "created_at", cutoff90),
      // 안전운행 기록만 시각 칸 이름이 recorded_at입니다(다른 표는 created_at).
      purge("shuttle_safety_events", "recorded_at", cutoff90),
      purge("ai_usage_logs", "created_at", cutoff90),
      purge("error_logs", "created_at", cutoff30),
      purge("google_chat_mirror_messages", "created_at_google", cutoff180),
    ]);

    return NextResponse.json({
      ok: true,
      retentionDays: RETENTION_DAYS,
      purgedPings: pings?.length ?? 0,
      purgedObservations: observations?.length ?? 0,
      purgedPickupTexts: purgedTexts?.length ?? 0,
      purgedRunEvents: runEvents,
      purgedSafetyEvents: safetyEvents,
      purgedAiLogs: aiLogs,
      purgedErrorLogs: errorLogs,
      purgedMirroredMessages: mirrored,
    });
  } catch (err) {
    await logApiError(supabase, "cron:purge-shuttle-locations", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
