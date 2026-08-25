import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { pollNewMessages, type GoogleChatSourceKey } from "@/lib/googleChat";

// 선생님요청 방은 아직 만들어지지 않았습니다(구글챗_미러링_설정가이드 STEP 5) - 목록에
// 없는 소스를 계속 폴링하면 헛수고일 뿐 아니라, GOOGLE_CHAT_SPACE_TEACHER_REQUESTS가
// 비어있거나 잘못 설정된 경우 메시지가 엉뚱한 source_key로 잘못 태그될 위험도 있어서
// 방이 실제로 만들어지고 환경변수가 채워질 때까지 빼둡니다.
const SOURCE_KEYS: GoogleChatSourceKey[] = ["attendance"];

// 외부 무료 스케줄러(cron-job.org 등, 가이드 참고)가 1분마다 이 라우트를 호출합니다. Vercel
// 무료(Hobby) 플랜은 Pub/Sub 같은 진짜 실시간 push를 못 받고, 외부 스케줄러도 1분보다 잦은
// 간격은 대부분 유료입니다 - 그래서 라우트가 호출된 뒤 함수 실행시간 예산 안에서 직접 여러 번
// 반복 폴링을 돌려, 외부 호출은 1분에 한 번이어도 실제 메시지 반영은 수 초~수십 초 안에
// 이뤄지도록 합니다(요청: "1분의 지연은 너무 큰데 최대한 빠르게 반영되었으면 좋겠어").
//
// 루프 예산은 30초가 아니라 25초입니다 - cron-job.org 무료 플랜의 요청 타임아웃 상한이
// 정확히 30초라서(발견: "The maximum timeout is 30 seconds" 오류), 그보다 5초 여유를 둬서
// 응답을 제때 못 보내 "실패"로 잘못 표시되는 상황을 막습니다.
export const maxDuration = 30;

const LOOP_BUDGET_MS = 25_000;
const LOOP_INTERVAL_MS = 3_000;

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
  let totalNew = 0;
  let rounds = 0;
  let lastError: string | null = null;

  while (Date.now() - startedAt < LOOP_BUDGET_MS) {
    rounds += 1;
    for (const sourceKey of SOURCE_KEYS) {
      try {
        totalNew += await pollNewMessages(supabase, sourceKey);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await logApiError(supabase, `cron:poll-chat-messages:${sourceKey}`, err);
      }
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= LOOP_BUDGET_MS) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(LOOP_INTERVAL_MS, LOOP_BUDGET_MS - elapsed)));
  }

  // 구글챗 연결상태 하트비트(요청: "구글챗, 토들 연결상태를 업무보드에서 볼 수 있게").
  // 토들 수집기와 같은 원칙입니다 - 미러링이 조용히 멈추면(토큰 만료, 크론 중단) 화면에는
  // 그저 "새 메시지가 없는 것"처럼 보여서 멈춘 줄 모릅니다. 크론이 돌 때마다 여기 신호를
  // 남기고, 업무 보드 인박스가 이 시각이 오래됐으면 빨간불을 켭니다. 폴링이 전부 실패한
  // 회차는 status를 error로 남겨 "돌고는 있는데 못 읽는" 상태도 구분합니다.
  await supabase.from("integration_heartbeats").upsert({
    key: "google-chat-poll",
    last_seen_at: new Date().toISOString(),
    status: lastError ? "error" : "ok",
    detail: lastError ? lastError.slice(0, 300) : null,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, rounds, newMessages: totalNew, lastError });
}
