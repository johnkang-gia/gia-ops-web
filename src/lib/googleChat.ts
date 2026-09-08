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
  /**
   * 보내기 권한.
   *
   * 직원들은 구글챗을 띄워놓고 일합니다. 우리 화면에서 **읽기만** 되면 답할 때마다 구글챗을
   * 열어야 하고, 그러면 창이 하나도 안 줄어 이 화면을 띄울 자리가 여전히 없습니다.
   * 읽고 답하는 것까지 되어야 창 하나를 실제로 닫을 수 있습니다.
   *
   * 이 권한을 더한 뒤에는 **한 번 재인증**해야 합니다 - 예전 토큰에는 이 권한이 없습니다.
   * 화면이 그 사실을 알려줍니다(조용히 실패하면 「답장 버튼이 안 먹는다」로만 보입니다).
   */
  "https://www.googleapis.com/auth/chat.messages.create",
  /**
   * 방에 누가 있는지 보는 권한.
   *
   * 구글챗에서 @멘션은 **글자가 아니라 사람 번호**입니다 - 본문에 `<users/1234>` 라고 써야
   * 상대에게 알림이 갑니다. 「@김선생님」이라고 글자만 적으면 보낸 쪽은 불렀다고 생각하고
   * 받는 쪽은 알림을 못 받습니다. 번호를 알려면 방 멤버 목록이 필요합니다.
   */
  "https://www.googleapis.com/auth/chat.memberships.readonly",
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
  /**
   * 사진·파일.
   *
   * 구글이 주는 주소는 **로그인해야 열립니다.** 그대로 저장해두면 우리 화면에서는 깨진
   * 그림으로만 보입니다. 그래서 받아서 우리 저장소로 옮깁니다.
   */
  attachment?: {
    name?: string;
    contentName?: string;
    contentType?: string;
    attachmentDataRef?: { resourceName?: string };
    driveDataRef?: { driveFileId?: string };
  }[];
};

/** 우리 저장소로 옮긴 첨부 한 개. `path` 가 비면 **못 가져온 것**입니다. */
export type SavedAttachment = {
  name: string;
  contentType: string | null;
  /** chat-attachments 버킷 경로. 못 가져왔으면 null 이고 why 에 이유가 있습니다. */
  path: string | null;
  why?: string;
};

const ATTACHMENT_BUCKET = "chat-attachments";

/** 파일 이름에서 경로를 깨뜨리는 글자를 걷어냅니다. 한글 이름은 그대로 둡니다. */
function safeName(name: string): string {
  return name.replace(/[/\\?%*:|"<>\s]+/g, "_").slice(0, 80) || "file";
}

/**
 * 첨부를 구글에서 받아 우리 저장소에 넣습니다.
 *
 * 실패해도 **메시지 저장은 계속합니다** - 사진 하나 때문에 그 메시지가 통째로 사라지면
 * 「다친 아이 이야기가 아예 안 왔다」가 됩니다. 대신 왜 못 가져왔는지를 함께 남겨서
 * 화면이 「사진을 못 가져왔습니다」라고 말할 수 있게 합니다.
 */
async function saveAttachments(
  supabase: SupabaseClient,
  token: string,
  messageName: string,
  list: ChatMessageResource["attachment"],
): Promise<SavedAttachment[]> {
  const out: SavedAttachment[] = [];
  for (const a of list ?? []) {
    const label = a.contentName || "첨부";
    const resource = a.attachmentDataRef?.resourceName;
    if (!resource) {
      // 구글 드라이브에 올린 파일은 주소가 아니라 드라이브 파일입니다. 드라이브 권한이
      // 따로 있어야 해서 지금은 가져오지 않습니다 - 링크로 올라오는 경우라 본문에 주소가
      // 함께 옵니다.
      out.push({ name: label, contentType: a.contentType ?? null, path: null, why: "구글 드라이브 파일이라 가져오지 않습니다" });
      continue;
    }
    try {
      const res = await fetch(`${CHAT_API_BASE}/media/${encodeURIComponent(resource)}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        out.push({ name: label, contentType: a.contentType ?? null, path: null, why: `구글에서 받지 못했습니다(${res.status})` });
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      // 경로에 메시지 번호를 씁니다 - 같은 이름의 사진이 여러 번 올라와도 안 덮어씁니다.
      const path = `${messageName.replace(/[^A-Za-z0-9]/g, "_")}/${out.length}_${safeName(label)}`;
      const up = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, {
        contentType: a.contentType || "application/octet-stream",
        upsert: true,
      });
      if (up.error) {
        out.push({ name: label, contentType: a.contentType ?? null, path: null, why: `저장하지 못했습니다: ${up.error.message}` });
        continue;
      }
      out.push({ name: label, contentType: a.contentType ?? null, path });
    } catch (err) {
      out.push({
        name: label,
        contentType: a.contentType ?? null,
        path: null,
        why: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

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
/**
 * 구글챗 방에 답장을 보냅니다.
 *
 * `threadKey` 를 주면 그 갈래에 달립니다 - 학부모 문의처럼 오간 맥락이 있는 것은 새 줄로
 * 시작하면 받는 사람이 무슨 이야기인지 못 찾습니다.
 */
export async function postMessage(
  supabase: SupabaseClient,
  spaceId: string,
  text: string,
  threadName?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getAccessToken(supabase);
  if (!token) return { ok: false, error: "구글챗 계정 인증이 아직 안 되어 있습니다." };

  // 갈래에 달 때는 「그 갈래가 없으면 새로 만들라」고 알려줘야 합니다. 안 그러면 갈래가
  // 사라진 경우에 통째로 실패합니다.
  const qs = threadName ? "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : "";
  const res = await fetch(`${CHAT_API_BASE}/${spaceId}/messages${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(threadName ? { text, thread: { name: threadName } } : { text }),
  });
  if (res.ok) return { ok: true };

  const body = await res.text().catch(() => "");
  // 권한이 모자란 경우를 **따로 알려줍니다.** 「403」만 띄우면 사람은 무엇을 해야 할지
  // 모르고, 이 경우 해야 할 일은 딱 하나 - 재인증입니다.
  if (res.status === 403 || /insufficient|scope/i.test(body)) {
    return {
      ok: false,
      error: "보내기 권한이 없습니다. 연동 상태 화면에서 구글챗을 한 번 다시 연결해주세요(권한이 하나 늘었습니다).",
    };
  }
  return { ok: false, error: `${res.status} ${body.slice(0, 200)}` };
}

/** 미러링할 방 한 줄. */
export type ChatSpaceRow = {
  google_space_id: string;
  display_name: string | null;
  source_key: GoogleChatSourceKey | null;
  enabled: boolean;
  sort_order: number;
};

/**
 * 환경변수에 적혀 있던 두 방을 표에 옮겨 심습니다.
 *
 * 방 목록이 환경변수에 있으면 방 하나 더 보려고 배포를 해야 합니다. 표로 옮기되, 예전 두 방은
 * 화면 여러 곳이 `source_key` 로 걸러 읽고 있어서 그 이름을 그대로 붙여둡니다.
 */
export async function seedSpacesFromEnv(supabase: SupabaseClient): Promise<void> {
  const seeds: { id: string | undefined; key: GoogleChatSourceKey; label: string; order: number }[] = [
    { id: process.env.GOOGLE_CHAT_SPACE_ATTENDANCE, key: "attendance", label: "출결알림", order: 1 },
    { id: process.env.GOOGLE_CHAT_SPACE_TEACHER_REQUESTS, key: "teacher_requests", label: "선생님요청", order: 2 },
  ];
  for (const s of seeds) {
    if (!s.id) continue;
    // 이미 있으면 건드리지 않습니다 - 사람이 화면에서 끈 방을 배포할 때마다 다시 켜면
    // 「껐는데 또 켜져 있다」가 됩니다.
    const { data } = await supabase.from("google_chat_spaces").select("google_space_id").eq("google_space_id", s.id).maybeSingle();
    if (data) continue;
    await supabase.from("google_chat_spaces").insert({
      google_space_id: s.id,
      display_name: s.label,
      source_key: s.key,
      // 선생님요청 방은 아직 안 만들어졌을 수 있습니다. 없는 방을 켜두면 폴링이 매번
      // 404 로 실패하고, 그 실패가 연결상태를 빨간불로 만듭니다.
      enabled: s.key === "attendance",
      sort_order: s.order,
    });
  }
}

/** 지금 켜져 있는 방들. */
export async function enabledSpaces(supabase: SupabaseClient): Promise<ChatSpaceRow[]> {
  const { data } = await supabase
    .from("google_chat_spaces")
    .select("google_space_id, display_name, source_key, enabled, sort_order")
    .eq("enabled", true)
    .order("sort_order");
  return (data as ChatSpaceRow[] | null) ?? [];
}

type GoogleSpace = { name?: string; displayName?: string; spaceType?: string; singleUserBotDm?: boolean };

/**
 * 계정이 들어가 있는 방을 구글에서 받아 표에 넣습니다.
 *
 * **켜기는 사람이 합니다.** 새로 찾은 방은 꺼진 채로 들어옵니다 - 계정이 들어가 있는 방이
 * 수십 개일 수 있고, 전부 미러링하면 인박스가 남의 대화로 덮입니다.
 */
export async function syncSpaceList(
  supabase: SupabaseClient,
): Promise<{ ok: true; found: number; added: number } | { ok: false; error: string }> {
  const token = await getAccessToken(supabase);
  if (!token) return { ok: false, error: "구글챗 계정 인증이 아직 안 되어 있습니다." };

  const spaces: GoogleSpace[] = [];
  let pageToken = "";
  // 방이 많은 계정도 있습니다. 페이지를 끝까지 따라갑니다 - 첫 장만 읽으면 찾는 방이 없는데
  // 화면에는 「그런 방이 없습니다」로 보입니다.
  for (let page = 0; page < 10; page++) {
    const url = `${CHAT_API_BASE}/spaces?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 403 || /insufficient|scope/i.test(body)) {
        return { ok: false, error: "방 목록을 볼 권한이 없습니다. 연동 상태 화면에서 구글챗을 다시 연결해주세요." };
      }
      return { ok: false, error: `방 목록을 받지 못했습니다(${res.status}).` };
    }
    const body = (await res.json()) as { spaces?: GoogleSpace[]; nextPageToken?: string };
    spaces.push(...(body.spaces ?? []));
    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }

  // 1:1 대화(DM)는 빼둡니다 - 업무 화면에 개인 대화가 섞이면 곤란합니다.
  const rooms = spaces.filter((s) => s.name && s.spaceType !== "DIRECT_MESSAGE" && !s.singleUserBotDm);

  const { data: known } = await supabase.from("google_chat_spaces").select("google_space_id");
  const knownIds = new Set(((known as { google_space_id: string }[] | null) ?? []).map((r) => r.google_space_id));

  let added = 0;
  for (const s of rooms) {
    const id = s.name as string;
    if (knownIds.has(id)) {
      // 이름만 갱신합니다(방 이름은 바뀝니다). 켜짐 여부는 사람이 정한 것이라 건드리지 않습니다.
      await supabase.from("google_chat_spaces").update({ display_name: s.displayName ?? null, updated_at: new Date().toISOString() }).eq("google_space_id", id);
      continue;
    }
    const { error } = await supabase.from("google_chat_spaces").insert({
      google_space_id: id,
      display_name: s.displayName ?? null,
      enabled: false,
    });
    if (!error) added += 1;
  }
  return { ok: true, found: rooms.length, added };
}

type GoogleMembership = { member?: { name?: string; displayName?: string; type?: string } };

/**
 * 방에 누가 있는지 받아둡니다. @멘션에 쓸 사람 번호입니다.
 *
 * 이걸 안 해두면 답장에 「@김선생님」이라고 **글자만** 나가고, 받는 분께는 알림이 안 갑니다.
 * 부른 줄 알고 기다리는 것이 가장 나쁩니다.
 */
export async function syncSpaceMembers(
  supabase: SupabaseClient,
  spaceId: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const token = await getAccessToken(supabase);
  if (!token) return { ok: false, error: "구글챗 계정 인증이 아직 안 되어 있습니다." };

  const rows: { google_space_id: string; google_user_id: string; display_name: string | null; updated_at: string }[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const url = `${CHAT_API_BASE}/${spaceId}/members?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 403 || /insufficient|scope/i.test(body)) {
        return { ok: false, error: "방 사람 목록을 볼 권한이 없습니다. 연동 상태 화면에서 구글챗을 다시 연결해주세요." };
      }
      return { ok: false, error: `사람 목록을 받지 못했습니다(${res.status}).` };
    }
    const body = (await res.json()) as { memberships?: GoogleMembership[]; nextPageToken?: string };
    for (const m of body.memberships ?? []) {
      const id = m.member?.name;
      // 봇은 부를 일이 없습니다.
      if (!id || m.member?.type === "BOT") continue;
      rows.push({ google_space_id: spaceId, google_user_id: id, display_name: m.member?.displayName ?? null, updated_at: new Date().toISOString() });
    }
    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }
  if (rows.length > 0) {
    const { error } = await supabase.from("google_chat_members").upsert(rows, { onConflict: "google_space_id,google_user_id" });
    if (error) return { ok: false, error: `사람 목록을 저장하지 못했습니다: ${error.message}` };
  }
  return { ok: true, count: rows.length };
}

/** 켜져 있는 방을 모두 한 바퀴 돕니다. 한 방이 실패해도 나머지는 계속 읽습니다. */
export async function pollAllSpaces(supabase: SupabaseClient): Promise<{ total: number; errors: string[] }> {
  await seedSpacesFromEnv(supabase);
  const spaces = await enabledSpaces(supabase);
  let total = 0;
  const errors: string[] = [];
  for (const space of spaces) {
    try {
      total += await pollSpace(supabase, space);
      await supabase
        .from("google_chat_spaces")
        .update({ last_polled_at: new Date().toISOString(), last_error: null })
        .eq("google_space_id", space.google_space_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${space.display_name ?? space.google_space_id}: ${msg}`);
      // 어느 방이 왜 안 되는지 표에 남깁니다. 화면이 그 방 옆에 그대로 띄웁니다 - 전체가
      // 「연결 안 됨」으로만 보이면 어느 방을 손봐야 하는지 알 수 없습니다.
      await supabase
        .from("google_chat_spaces")
        .update({ last_polled_at: new Date().toISOString(), last_error: msg.slice(0, 300) })
        .eq("google_space_id", space.google_space_id);
    }
  }
  return { total, errors };
}

export async function pollSpace(supabase: SupabaseClient, space: ChatSpaceRow): Promise<number> {
  const token = await getAccessToken(supabase);
  const spaceId = space.google_space_id;
  if (!token) throw new Error("구글챗 계정 인증이 아직 완료되지 않았습니다(/api/google-chat/oauth/start에서 먼저 로그인해주세요).");
  if (!spaceId) throw new Error("구글챗 미러링 환경변수가 설정되지 않았습니다(스페이스 ID 누락).");

  // 커서는 **그 방의** 마지막 메시지 시각입니다. 예전에는 source_key 로 찾았는데, 방이
  // 여럿이 되면 한 방의 최신 시각이 다른 방의 과거 메시지를 건너뛰게 만듭니다.
  const { data: latest } = await supabase
    .from("google_chat_mirror_messages")
    .select("created_at_google")
    .eq("google_space_id", spaceId)
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
    if (!retriable) throw new Error(`메시지 조회 실패: ${res.status} ${lastText}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt))); // 0.5s, 1s, 2s
  }
  if (!res || !res.ok) throw new Error(`메시지 조회 실패(재시도 후에도 실패): ${res?.status ?? "?"} ${lastText}`);

  const body = (await res.json()) as { messages?: ChatMessageResource[] };
  const messages = body.messages ?? [];
  if (messages.length === 0) return 0;

  const sourceKey = space.source_key ?? "room";

  const rows: Record<string, unknown>[] = [];
  for (const m of messages) {
    // 예전에는 본문이 없으면 통째로 버렸습니다. **사진만 올라온 메시지가 그렇습니다** -
    // 다친 아이 사진이 바로 그렇게 올라오는데, 화면에는 그 메시지가 «없는 것»으로 보였습니다.
    if (!m.name) continue;
    const hasAttachment = (m.attachment ?? []).length > 0;
    if (typeof m.text !== "string" && !hasAttachment) continue;

    const saved = hasAttachment ? await saveAttachments(supabase, token, m.name, m.attachment) : [];
    rows.push({
      source_key: sourceKey,
      google_message_id: m.name,
      google_space_id: m.space?.name ?? spaceId,
      sender_display_name: m.sender?.displayName ?? null,
      sender_email: m.sender?.email ?? null,
      content: m.text ?? "",
      created_at_google: m.createTime ?? new Date().toISOString(),
      // 멘션 구간을 그대로 남깁니다. 없으면 null - 뒤에서 «좌표를 못 받은 줄»로 알아봅니다.
      mentions: mentionSpansOf(m).length > 0 ? mentionSpansOf(m) : null,
      attachments: saved.length > 0 ? saved : null,
    });
  }
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from("google_chat_mirror_messages")
    .upsert(rows, { onConflict: "google_message_id", ignoreDuplicates: true });
  if (error) throw new Error(`메시지 저장 실패: ${error.message}`);

  return rows.length;
}
