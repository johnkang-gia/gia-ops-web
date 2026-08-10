// Web Push(VAPID) 발송 헬퍼 - 학부모 테스트 화면(2단계-c)에서 탑승/하차가 확인되면 구독 중인
// 기기로 알림을 보냅니다. 별도 회원가입이 필요한 Firebase Cloud Messaging 대신 브라우저 표준
// Web Push를 쓰므로, VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 두 값만 Vercel 환경변수에 추가하면
// 됩니다(발급은 web-push 패키지의 generateVAPIDKeys()로 로컬에서 1회만 하면 되고, 외부 계정
// 가입이 필요 없습니다). 공개키는 NEXT_PUBLIC_VAPID_PUBLIC_KEY로도 동일한 값을 넣어 클라이언트
// 구독 시 함께 씁니다.
import webpush from "web-push";

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails("mailto:one2k87@gmail.com", publicKey, privateKey);
  configured = true;
  return true;
}

// 실패해도(구독 만료 등) 다른 기기 발송에는 영향 없도록 개별적으로 흡수합니다. 만료된 구독(410/404)은
// 호출부에서 지워낼 수 있도록 만료 여부를 함께 돌려줍니다.
export async function sendPushToSubscription(
  sub: PushSubscriptionRow,
  payload: { title: string; body: string }
): Promise<{ ok: boolean; expired: boolean }> {
  if (!ensureConfigured()) return { ok: false, expired: false };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return { ok: true, expired: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    return { ok: false, expired: statusCode === 404 || statusCode === 410 };
  }
}
