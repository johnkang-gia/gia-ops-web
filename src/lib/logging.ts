// 관리자 대시보드(오류 로그/AI 사용량)에서 쓰는 공용 로깅 헬퍼입니다. 로깅 자체가 실패해도
// 실제 요청 처리 흐름(사용자에게 보여지는 응답)에는 절대 영향을 주면 안 되므로, 모든 함수가
// 내부에서 에러를 삼키고 조용히 무시합니다.

import { notifySlack } from "@/lib/slack";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logApiError(
  supabase: any,
  route: string,
  err: unknown,
  userEmail?: string | null
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    const stack = err instanceof Error ? err.stack ?? null : null;
    await supabase.from("error_logs").insert({
      route,
      message: message.slice(0, 2000),
      stack: stack ? stack.slice(0, 4000) : null,
      user_email: userEmail ?? null,
    });
  } catch {
    // 로그 적재 실패는 무시합니다(원래 요청은 이미 정상적으로 에러 응답을 내려주는 중).
  }
  // 요청: "오류메세지도 슬랙을 통해서 받을 수 있게" - error_logs 저장과 별개로 Slack에도
  // 바로 알립니다(웹훅 미설정 시 notifySlack이 조용히 아무것도 안 함).
  await notifySlack(
    `🚨 오류 발생\n라우트: \`${route}\`\n${userEmail ? `사용자: ${userEmail}\n` : ""}메시지: ${message.slice(0, 500)}`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logAiUsage(
  supabase: any,
  entry: {
    route: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    success: boolean;
    errorMessage?: string | null;
  }
): Promise<void> {
  try {
    await supabase.from("ai_usage_logs").insert({
      route: entry.route,
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      success: entry.success,
      error_message: entry.errorMessage ? entry.errorMessage.slice(0, 2000) : null,
    });
  } catch {
    // 로그 적재 실패가 실제 AI 응답 처리에 영향을 주면 안 되므로 무시합니다.
  }
}
