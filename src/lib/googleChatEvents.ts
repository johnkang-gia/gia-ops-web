import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "./googleChat";

// 구글챗 새 메시지를 **밀어서** 받기 위한 구독 관리(Google Workspace Events API).
//
// 왜 필요한가요?
//   지금까지는 1분마다 구글챗에 "새 거 있나요?"를 물었습니다. 그런데 외부 스케줄러가 1분마다
//   부르는데 함수는 25초만 도니까, **매 분 35초는 아무도 안 보고 있는 공백**이 남습니다.
//   담당자 확인: 픽업 연락이 늦게 반영되면 아이가 이미 차에 타 있을 수 있습니다. 폴링으로는
//   이 공백을 없앨 수 없어서, 구글이 새 메시지를 올라오는 즉시 우리에게 알려주도록 바꿉니다.
//
// 구조는 이렇습니다.
//   구글챗에 메시지 → 구글이 Pub/Sub 토픽에 발행 → Pub/Sub가 우리 /api/google-chat/push를
//   호출 → 우리가 그때 구글챗을 읽어서 저장.
//
// 마지막 단계가 중요합니다. **알림에 실린 내용은 쓰지 않고, 알림을 초인종으로만 씁니다.**
// (createSubscription의 includeResource를 false로 두는 이유 - 아래 주석에 자세히 적었습니다.)
//
// 인증은 지금 쓰고 있는 그 사용자 OAuth 토큰을 그대로 씁니다. 스페이스 구독은 관리자 권한이
// 아니라 "구독을 승인하는 사람이 그 스페이스의 멤버일 것"만 요구하고, 필요한 스코프
// (chat.messages.readonly)는 이미 받아둔 상태입니다.

const EVENTS_API = "https://workspaceevents.googleapis.com/v1";
const EVENT_TYPE_MESSAGE_CREATED = "google.workspace.chat.message.v1.created";

export type ChatSubscriptionRow = {
  space_id: string;
  subscription_name: string;
  uid: string | null;
  expire_time: string | null;
};

type SubscriptionResource = {
  name?: string;
  uid?: string;
  expireTime?: string;
  state?: string;
  targetResource?: string;
};

// Events API는 create/patch가 곧바로 끝나지 않고 "장기 실행 작업"을 돌려줍니다. 대부분은 이미
// 끝난 채로 오지만(done: true), 그 안에 진짜 결과가 response로 한 겹 싸여 있습니다.
type LongRunningOperation = {
  done?: boolean;
  response?: SubscriptionResource;
  error?: { message?: string };
};

function unwrap(op: LongRunningOperation): SubscriptionResource {
  if (op.error?.message) throw new Error(op.error.message);
  return op.response ?? {};
}

async function callEventsApi(token: string, path: string, init?: RequestInit): Promise<LongRunningOperation> {
  const res = await fetch(`${EVENTS_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 구글의 오류 메시지를 그대로 올려보냅니다 - "스페이스 멤버가 아님", "토픽에 발행 권한이
    // 없음" 같은 것들이라, 뭉뚱그리면 어디를 고쳐야 할지 알 수 없게 됩니다.
    const msg = body?.error?.message ?? `${res.status} ${res.statusText}`;
    throw new Error(`Workspace Events API: ${msg}`);
  }
  return body as LongRunningOperation;
}

/** 이 스페이스의 새 메시지를 Pub/Sub 토픽으로 밀어달라고 구독을 겁니다. */
export async function createSubscription(supabase: SupabaseClient, spaceId: string, pubsubTopic: string): Promise<SubscriptionResource> {
  const token = await getAccessToken(supabase);
  if (!token) throw new Error("구글챗 계정 인증이 아직 완료되지 않았습니다(/api/google-chat/oauth/start에서 먼저 로그인해주세요).");

  const op = await callEventsApi(token, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      targetResource: `//chat.googleapis.com/spaces/${spaceId}`,
      eventTypes: [EVENT_TYPE_MESSAGE_CREATED],
      notificationEndpoint: { pubsubTopic },
      // 메시지 본문을 알림에 실어 보내지 **않습니다.** 두 가지 이유가 있습니다.
      //
      //  ① 안전. 알림 내용을 그대로 믿고 저장하면, 누가 가짜 알림을 흉내 냈을 때 가짜 메시지가
      //     인박스에 들어옵니다. 내용을 안 싣고 "뭔가 왔다"만 받으면, 우리는 그 신호를 듣고
      //     **우리 토큰으로 구글챗을 직접 읽습니다.** 가짜 알림으로 할 수 있는 최악이
      //     "쓸데없이 한 번 더 읽게 만드는 것"뿐이 됩니다.
      //  ② 수명. 본문을 실으면 구독 만료가 몇 시간으로 짧아지고, 빼면 훨씬 길어집니다.
      //     갱신이 한 번 실패해도 버틸 여유가 생깁니다.
      payloadOptions: { includeResource: false },
    }),
  });
  return unwrap(op);
}

/**
 * 구독을 최대 기한으로 되돌립니다(ttl "0s" = 가능한 최대).
 *
 * 구글 문서의 권고: 만료 임박 알림에 기대지 말고 만료 시각을 직접 추적해 갱신할 것. 그래서
 * 크론이 매일 한 번 무조건 갱신합니다 - 만료가 언제든 하루 앞은 늘 확보돼 있습니다.
 */
export async function renewSubscription(supabase: SupabaseClient, subscriptionName: string): Promise<SubscriptionResource> {
  const token = await getAccessToken(supabase);
  if (!token) throw new Error("구글챗 계정 인증이 아직 완료되지 않았습니다.");
  const id = subscriptionName.replace(/^subscriptions\//, "");
  const op = await callEventsApi(token, `/subscriptions/${encodeURIComponent(id)}?updateMask=ttl`, {
    method: "PATCH",
    body: JSON.stringify({ ttl: "0s" }),
  });
  return unwrap(op);
}

/** 구독이 살아있는지 확인합니다(없거나 지워졌으면 null). */
export async function getSubscription(supabase: SupabaseClient, subscriptionName: string): Promise<SubscriptionResource | null> {
  const token = await getAccessToken(supabase);
  if (!token) return null;
  const id = subscriptionName.replace(/^subscriptions\//, "");
  const res = await fetch(`${EVENTS_API}/subscriptions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as SubscriptionResource;
}

/** 구독 상태를 우리 DB에 기록해 둡니다(만료 시각을 우리가 추적하기 위해). */
export async function saveSubscriptionRow(supabase: SupabaseClient, spaceId: string, sub: SubscriptionResource): Promise<void> {
  await supabase.from("google_chat_event_subscriptions").upsert(
    {
      space_id: spaceId,
      subscription_name: sub.name ?? "",
      uid: sub.uid ?? null,
      expire_time: sub.expireTime ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "space_id" },
  );
}

export async function loadSubscriptionRow(supabase: SupabaseClient, spaceId: string): Promise<ChatSubscriptionRow | null> {
  const { data } = await supabase
    .from("google_chat_event_subscriptions")
    .select("space_id, subscription_name, uid, expire_time")
    .eq("space_id", spaceId)
    .maybeSingle();
  return (data as ChatSubscriptionRow | null) ?? null;
}

/** 미러링 중인 스페이스 ID들(환경변수에 설정된 것만). */
export function mirroredSpaceIds(): string[] {
  return [process.env.GOOGLE_CHAT_SPACE_ATTENDANCE, process.env.GOOGLE_CHAT_SPACE_TEACHER_REQUESTS].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}
