import { OAuth2Client } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleChatMirrorSourceKey } from "@/lib/types";

// 구글챗 미러링(출결알림/선생님요청 실시간 읽기전용 미러) 인증 헬퍼입니다.
//
// 처음에는 서비스 계정 + 도메인 전체 위임 방식으로 설계했지만, 그러려면 Google Workspace
// 관리자 콘솔 접근 권한이 필요해서(강경원님은 직원 계정이라 해당 권한이 없고, 아직 테스트
// 단계라 관리자님께 매번 요청드리기 부담스러운 상황) 본인 계정으로 직접 로그인해서 인증하는
// 일반 OAuth 방식으로 바꿨습니다. Chat API는 "그 방에 접근 권한이 있는 사용자 본인의
// 자격증명"으로도 동작하므로, 강경원님이 두 방(출결알림/선생님요청) 모두의 멤버라면 관리자
// 승인 없이 본인만으로 설정을 끝낼 수 있습니다.
//
// 두 번째로, Workspace Events API + Pub/Sub push 구독 방식(실시간)을 시도했지만, Pub/Sub
// 주제에 구글 시스템 계정(chat-api-push@system.gserviceaccount.com)을 Publisher로 추가하는
// 단계에서 조직의 "Domain Restricted Sharing" 정책(constraints/iam.allowedPolicyMemberDomains)에
// 막혔습니다 - 이건 GCP 조직 정책 관리자 권한이 있어야 풀 수 있는데, 그 권한 자체가 이번
// 설계의 출발점이었던 "관리자 승인 없이 혼자 끝내기"와 상충합니다. 그래서 Pub/Sub을 아예
// 걷어내고, 앱이 주기적으로 Chat API(spaces.messages.list)를 직접 조회하는 폴링 방식으로
// 다시 바꿨습니다 - IAM 권한 변경이 전혀 필요 없어 조직 정책과 무관하게 강경원님 계정만으로
// 동작합니다.
//
// 흐름: /api/google-chat/oauth/start(개발자 전용)에서 구글 로그인 동의 화면으로 보내고,
// /api/google-chat/oauth/callback이 그 결과로 받은 refresh_token을 DB(google_chat_oauth_tokens,
// 항상 한 행만 존재)에 저장합니다. 이후 폴링은 이 refresh_token으로 access token을 새로
// 발급받아 씁니다. googleapis 전체 패키지(수십MB) 대신 google-auth-library의 OAuth2Client만
// 써서 access token을 받고, 나머지는 REST(fetch)로 직접 호출합니다 - Vercel 서버리스 함수
// 크기를 작게 유지하기 위함입니다.

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
// 쓰는 서버 라우트(크론)만 이 값을 읽고 쓸 수 있습니다 - refresh_token은 사실상 이 앱이
// 구글챗을 대신 읽을 수 있는 열쇠라 화면 어디에도 노출하지 않습니다.
async function getStoredRefreshToken(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("google_chat_oauth_tokens").select("refresh_token").eq("id", "default").maybeSingle();
  return data?.refresh_token ?? null;
}

export async function saveRefreshToken(supabase: SupabaseClient, refreshToken: string, updatedBy: string): Promise<void> {
  await supabase
    .from("google_chat_oauth_tokens")
    .upsert({ id: "default", refresh_token: refreshToken, updated_by: updatedBy, updated_at: new Date().toISOString() });
}

export async function getAccessToken(supabase: SupabaseClient): Promise<string | null> {
  const client = buildOAuthClient();
  const refreshToken = await getStoredRefreshToken(supabase);
  if (!client || !refreshToken) return null;
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  return token ?? null;
}

const CHAT_API_BASE = "https://chat.googleapis.com/v1";

export type GoogleChatSourceKey = GoogleChatMirrorSourceKey;

function spaceEnvFor(sourceKey: GoogleChatSourceKey): string | undefined {
  return sourceKey === "attendance" ? process.env.GOOGLE_CHAT_SPACE_ATTENDANCE : process.env.GOOGLE_CHAT_SPACE_TEACHER_REQUESTS;
}

type ChatMessageResource = {
  name: string;
  text?: string;
  createTime?: string;
  space?: { name?: string };
  sender?: { displayName?: string; email?: string };
  /**
   * 구글챗이 알려주는 «본문 어디가 무엇인지».
   *
   * 여기 USER_MENTION 이 들어 있고, 그 안에 시작 위치와 길이가 있습니다. 이걸 안 쓰면
   * 우리가 `@` 뒤 글자를 보고 어디까지가 성함인지 **추측**해야 합니다.
   */
  annotations?: {
    type?: string;
    startIndex?: number;
    length?: number;
    userMention?: { user?: { name?: string; displayName?: string } };
  }[];
};

/** 본문에서 멘션이 차지하는 구간. 저장해두면 나중에 추측할 일이 없습니다. */
export type MentionSpan = { start: number; length: number; name: string | null; userId: string | null };

export function mentionSpansOf(m: ChatMessageResource): MentionSpan[] {
  return (m.annotations ?? [])
    .filter((a) => a.type === "USER_MENTION" && typeof a.startIndex === "number" && typeof a.length === "number")
    .map((a) => ({
      start: a.startIndex as number,
      length: a.length as number,
      name: a.userMention?.user?.displayName ?? null,
      userId: a.userMention?.user?.name ?? null,
    }))
    // 겹치거나 뒤죽박죽인 구간이 오면 뒤에서 자르기가 어긋납니다. 앞에서 정리해 둡니다.
    .filter((s) => s.start >= 0 && s.length > 0)
    .sort((a, b) => a.start - b.start);
}

// 두 방 각각에서 "마지막으로 저장한 메시지 시각 이후"의 새 메시지만 가져와 upsert합니다.
// 커서는 별도 테이블 없이 google_chat_mirror_messages의 최신 created_at_google을 그대로
// 씁니다(행이 없으면 5분 전부터 조회 - 최초 폴링 시 과거 메시지가 한꺼번에 쏟아지지 않도록).
// google_message_id에 unique 제약이 있어 같은 메시지가 겹쳐 조회돼도 upsert(ignoreDuplicates)로
// 한 번만 저장됩니다.
export async function pollNewMessages(supabase: SupabaseClient, sourceKey: GoogleChatSourceKey): Promise<number> {
  const token = await getAccessToken(supabase);
  const spaceId = spaceEnvFor(sourceKey);
  if (!token) throw new Error("구글챗 계정 인증이 아직 완료되지 않았습니다(/api/google-chat/oauth/start에서 먼저 로그인해주세요).");
  if (!spaceId) throw new Error("구글챗 미러링 환경변수가 설정되지 않았습니다(스페이스 ID 누락).");

  const { data: latest } = await supabase
    .from("google_chat_mirror_messages")
    .select("created_at_google")
    .eq("source_key", sourceKey)
    .order("created_at_google", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sinceIso = latest?.created_at_google ?? new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const filter = `createTime > "${sinceIso}"`;

  const url = `${CHAT_API_BASE}/${spaceId}/messages?filter=${encodeURIComponent(filter)}&orderBy=${encodeURIComponent("createTime asc")}&pageSize=100`;

  // 구글챗 API는 종종 일시적인 500(INTERNAL)·503·429를 돌려줍니다("Retry the request later").
  // 이때 그냥 실패로 끝내면 그 라운드의 출결 메시지를 통째로 못 읽으므로, 짧은 지수 백오프로
  // 최대 4번까지 다시 시도합니다. 400/401/403 같은 "다시 해도 똑같은" 오류는 바로 던집니다.
  let res: Response | null = null;
  let lastText = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) break;
    const retriable = res.status === 429 || res.status >= 500;
    lastText = await res.text().catch(() => "");
    if (!retriable) throw new Error(`메시지 조회 실패(${sourceKey}): ${res.status} ${lastText}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt))); // 0.5s, 1s, 2s
  }
  if (!res || !res.ok) throw new Error(`메시지 조회 실패(${sourceKey}, 재시도 후에도 실패): ${res?.status ?? "?"} ${lastText}`);

  const body = (await res.json()) as { messages?: ChatMessageResource[] };
  const messages = body.messages ?? [];
  if (messages.length === 0) return 0;

  const rows = messages
    .filter((m) => typeof m.text === "string" && m.name)
    .map((m) => ({
      source_key: sourceKey,
      google_message_id: m.name,
      google_space_id: m.space?.name ?? spaceId,
      sender_display_name: m.sender?.displayName ?? null,
      sender_email: m.sender?.email ?? null,
      content: m.text as string,
      created_at_google: m.createTime ?? new Date().toISOString(),
      // 멘션 구간을 그대로 남깁니다. 없으면 null - 뒤에서 «좌표를 못 받은 줄»로 알아봅니다.
      mentions: mentionSpansOf(m).length > 0 ? mentionSpansOf(m) : null,
    }));
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from("google_chat_mirror_messages")
    .upsert(rows, { onConflict: "google_message_id", ignoreDuplicates: true });
  if (error) throw new Error(`메시지 저장 실패(${sourceKey}): ${error.message}`);

  return rows.length;
}
