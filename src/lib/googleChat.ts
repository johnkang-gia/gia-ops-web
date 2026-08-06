import { JWT } from "google-auth-library";

// 구글챗 미러링(출결알림/선생님요청 실시간 읽기전용 미러) 인증 헬퍼입니다. Google Workspace
// Events API에서 특정 스페이스를 구독하려면 "그 스페이스에 접근 권한이 있는 사용자"로 인증해야
// 하는데(요청: "특정 스페이스만"), 서비스 계정 자체는 스페이스 멤버가 아니므로 도메인 위임
// (domain-wide delegation)으로 실제 멤버인 관리자 계정(GOOGLE_CHAT_IMPERSONATE_EMAIL)을
// 대신해 인증합니다. googleapis 전체 패키지(수십MB)를 번들에 넣는 대신 google-auth-library의
// JWT 클라이언트로 access token만 받고, 나머지는 REST(fetch)로 직접 호출합니다 - Vercel
// 서버리스 함수 크기를 작게 유지하기 위함입니다.
function getAuthClient(): JWT | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const subject = process.env.GOOGLE_CHAT_IMPERSONATE_EMAIL;
  if (!email || !key || !subject) return null;
  return new JWT({
    email,
    key,
    subject,
    scopes: ["https://www.googleapis.com/auth/chat.spaces.readonly", "https://www.googleapis.com/auth/chat.messages.readonly"],
  });
}

async function getAccessToken(): Promise<string | null> {
  const client = getAuthClient();
  if (!client) return null;
  const { token } = await client.getAccessToken();
  return token ?? null;
}

const EVENTS_API_BASE = "https://workspaceevents.googleapis.com/v1";

export type GoogleChatSourceKey = "attendance" | "teacher_requests";

function spaceEnvFor(sourceKey: GoogleChatSourceKey): string | undefined {
  return sourceKey === "attendance" ? process.env.GOOGLE_CHAT_SPACE_ATTENDANCE : process.env.GOOGLE_CHAT_SPACE_TEACHER_REQUESTS;
}

type SubscriptionResource = { name: string; expireTime: string; [key: string]: unknown };

// 새 구독을 만듭니다. targetResource는 "//chat.googleapis.com/spaces/AAAAxxxx" 형식이고, Pub/Sub
// 알림 대상은 "//pubsub.googleapis.com/projects/{project}/topics/{topic}" 형식입니다(가이드에서
// 안내하는 GOOGLE_PUBSUB_TOPIC 환경변수는 "projects/{project}/topics/{topic}" 부분만 담습니다).
export async function createSubscription(sourceKey: GoogleChatSourceKey): Promise<SubscriptionResource> {
  const token = await getAccessToken();
  const spaceId = spaceEnvFor(sourceKey);
  const topic = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!token || !spaceId || !topic) throw new Error("구글챗 미러링 환경변수가 설정되지 않았습니다.");

  const res = await fetch(`${EVENTS_API_BASE}/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      targetResource: `//chat.googleapis.com/${spaceId}`,
      eventTypes: ["google.workspace.chat.message.v1.created"],
      notificationEndpoint: { pubsubTopic: `//pubsub.googleapis.com/${topic}` },
      payloadOptions: { includeResource: true },
    }),
  });
  if (!res.ok) throw new Error(`구독 생성 실패(${sourceKey}): ${res.status} ${await res.text()}`);
  return res.json();
}

// 만료 시각을 연장합니다 - Workspace Events API 구독은 최대 TTL(생성 시점부터 최대 며칠)이
// 있어 그대로 두면 자동으로 끊기므로, 크론이 주기적으로 이 함수를 불러 연장합니다.
// subscriptionName은 "subscriptions/xxxxx" 형식으로, 최초 생성 응답의 name 값을
// google_chat_subscriptions 테이블에 저장해뒀다가 여기 다시 넣어줍니다.
export async function renewSubscription(subscriptionName: string, ttlSeconds = 6 * 24 * 60 * 60): Promise<SubscriptionResource> {
  const token = await getAccessToken();
  if (!token) throw new Error("구글챗 미러링 환경변수가 설정되지 않았습니다.");
  const res = await fetch(`${EVENTS_API_BASE}/${subscriptionName}?updateMask=ttl`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl: `${ttlSeconds}s` }),
  });
  if (!res.ok) throw new Error(`구독 갱신 실패(${subscriptionName}): ${res.status} ${await res.text()}`);
  return res.json();
}
