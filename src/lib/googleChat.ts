import { OAuth2Client } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";

// 구글챗 미러링(출결알림/선생님요청 실시간 읽기전용 미러) 인증 헬퍼입니다.
//
// 처음에는 서비스 계정 + 도메인 전체 위임 방식으로 설계했지만, 그러려면 Google Workspace
// 관리자 콘솔 접근 권한이 필요해서(강경원님은 직원 계정이라 해당 권한이 없고, 아직 테스트
// 단계라 관리자님께 매번 요청드리기 부담스러운 상황) 본인 계정으로 직접 로그인해서 인증하는
// 일반 OAuth 방식으로 바꿨습니다. Workspace Events API는 "그 스페이스에 접근 권한이 있는
// 사용자 본인의 자격증명"으로도 동작하므로, 강경원님이 두 방(출결알림/선생님요청) 모두의
// 멤버라면 관리자 승인 없이 본인만으로 설정을 끝낼 수 있습니다.
//
// 흐름: /api/google-chat/oauth/start(개발자 전용)에서 구글 로그인 동의 화면으로 보내고,
// /api/google-chat/oauth/callback이 그 결과로 받은 refresh_token을 DB(google_chat_oauth_tokens,
// 항상 한 행만 존재)에 저장합니다. 이후 구독 생성/갱신은 이 refresh_token으로 access token을
// 새로 발급받아 씁니다. googleapis 전체 패키지(수십MB) 대신 google-auth-library의
// OAuth2Client만 써서 access token을 받고, 나머지는 REST(fetch)로 직접 호출합니다 - Vercel
// 서버리스 함수 크기를 작게 유지하기 위함입니다.

export const GOOGLE_CHAT_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
];

export function buildOAuthClient(): OAuth2Client | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

// google_chat_oauth_tokens는 항상 id='default' 한 행만 존재하는 저장소입니다(요청 계정이 한
// 명뿐이라 굳이 여러 행을 둘 이유가 없습니다). RLS에 select 정책을 두지 않아, 서비스 롤 키를
// 쓰는 서버 라우트(크론/콜백)만 이 값을 읽고 쓸 수 있습니다 - refresh_token은 사실상 이 앱이
// 구글챗을 대신 읽을 수 있는 열쇠라 화면 어디에도 노출하지 않습니다.
export async function getStoredRefreshToken(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("google_chat_oauth_tokens").select("refresh_token").eq("id", "default").maybeSingle();
  return data?.refresh_token ?? null;
}

export async function saveRefreshToken(supabase: SupabaseClient, refreshToken: string, updatedBy: string): Promise<void> {
  await supabase
    .from("google_chat_oauth_tokens")
    .upsert({ id: "default", refresh_token: refreshToken, updated_by: updatedBy, updated_at: new Date().toISOString() });
}

async function getAccessToken(supabase: SupabaseClient): Promise<string | null> {
  const client = buildOAuthClient();
  const refreshToken = await getStoredRefreshToken(supabase);
  if (!client || !refreshToken) return null;
  client.setCredentials({ refresh_token: refreshToken });
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
export async function createSubscription(supabase: SupabaseClient, sourceKey: GoogleChatSourceKey): Promise<SubscriptionResource> {
  const token = await getAccessToken(supabase);
  const spaceId = spaceEnvFor(sourceKey);
  const topic = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!token) throw new Error("구글챗 계정 인증이 아직 완료되지 않았습니다(/api/google-chat/oauth/start에서 먼저 로그인해주세요).");
  if (!spaceId || !topic) throw new Error("구글챗 미러링 환경변수가 설정되지 않았습니다.");

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
export async function renewSubscription(
  supabase: SupabaseClient,
  subscriptionName: string,
  ttlSeconds = 6 * 24 * 60 * 60
): Promise<SubscriptionResource> {
  const token = await getAccessToken(supabase);
  if (!token) throw new Error("구글챗 계정 인증이 아직 완료되지 않았습니다(/api/google-chat/oauth/start에서 먼저 로그인해주세요).");
  const res = await fetch(`${EVENTS_API_BASE}/${subscriptionName}?updateMask=ttl`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl: `${ttlSeconds}s` }),
  });
  if (!res.ok) throw new Error(`구독 갱신 실패(${subscriptionName}): ${res.status} ${await res.text()}`);
  return res.json();
}
