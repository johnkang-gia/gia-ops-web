// Slack 알림 공용 헬퍼입니다. SLACK_WEBHOOK_URL 환경변수(Vercel에 등록)가 없으면 아무 일도
// 하지 않고 조용히 넘어갑니다 - 아직 웹훅을 설정하지 않은 환경(로컬 개발 등)에서도 에러 없이
// 그냥 알림만 안 가는 상태로 동작합니다. Slack 전송 실패도 절대 원래 요청 흐름에 영향을 주면
// 안 되므로 내부에서 에러를 삼킵니다.
export async function notifySlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    // fetch는 4xx/5xx 응답에도 예외를 던지지 않아서, Slack이 웹훅을 거부해도(예: 웹훅 삭제됨,
    // 채널 보관됨, payload 형식 오류) 지금까지는 아무 흔적 없이 조용히 실패하고 있었습니다
    // (요청: "슬랙연결했는데 가입 메세지가 안와"). 이제 실패 시 상태코드와 Slack의 응답 본문을
    // Vercel 함수 로그(console.error)에 남겨서, 정확한 실패 사유(웹훅 URL 문제 vs 그 외)를
    // Vercel 대시보드 → 프로젝트 → Logs에서 확인할 수 있게 했습니다.
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[slack] webhook rejected: ${res.status} ${res.statusText} - ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.error(`[slack] webhook request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
