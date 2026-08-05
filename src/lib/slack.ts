// Slack 알림 공용 헬퍼입니다. SLACK_WEBHOOK_URL 환경변수(Vercel에 등록)가 없으면 아무 일도
// 하지 않고 조용히 넘어갑니다 - 아직 웹훅을 설정하지 않은 환경(로컬 개발 등)에서도 에러 없이
// 그냥 알림만 안 가는 상태로 동작합니다. Slack 전송 실패도 절대 원래 요청 흐름에 영향을 주면
// 안 되므로 내부에서 에러를 삼킵니다.
export async function notifySlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Slack 전송 실패는 무시합니다(요청 처리와 무관한 부가 기능).
  }
}
