import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestPickup, loadRoster, type IngestInput } from "@/lib/pickupIngest";
import { logApiError } from "@/lib/logging";
import { notifyRefreshFromServer } from "@/lib/opsRefresh";

/**
 * **토들 서버 수집** — 사무실 PC 없이 서버가 직접 토들을 읽습니다.
 *
 * ── 왜 ──────────────────────────────────────────────────────────────────
 *
 * 크롬 확장 수집기는 확장을 깐 PC 한 대에서 토들 탭이 열려 있어야만 돌았습니다. 담당자가 자리를 옮기거나
 * 탭을 닫으면 그날 문의·픽업 수집이 통째로 멈췄습니다.
 *
 * 토들은 로그인 열쇠(JWT)를 `authorization: Bearer` 로 받아도 쿠키와 똑같이 답합니다(수집기 2.6.2 에서
 * 확인). 열쇠는 토들 화면의 localStorage `userInfo.jwt` 에 있고 유효기간이 깁니다(확인한 값은 2027-08 만료).
 * 그래서 그 열쇠와 학교 번호를 서버 환경변수(`TODDLE_JWT`, `TODDLE_ORG_ID`)에 두고, 1분마다 도는 크론
 * (poll-chat-messages)이 이 함수를 한 번 부릅니다.
 *
 * ── 지키는 것 ────────────────────────────────────────────────────────────
 *
 * - **읽기만 합니다.** 조회는 읽음 처리(insertUserChatActivityLog)를 하지 않아 선생님들의 «안 읽음»이 그대로입니다.
 * - 이미 저장한 글은 다시 넣지 않습니다(AI 분류가 글마다 돌아서, 다시 넣으면 비용만 듭니다).
 * - 확장 수집기와 함께 돌아도 됩니다. 같은 글은 source_ref 로 한 줄입니다.
 * - 열쇠가 만료되면 «login_required» 신호를 남겨 연동 상태·경보가 빨갛게 됩니다. 조용히 0건으로 두지 않습니다.
 */

const ENDPOINT = "https://ap-southeast-1-production-apis.toddleapp.com/graphql";
const AUTH_ERROR = /jwt|expired|un-?authenticat|unauthori[sz]ed|not\s*logged/i;
/** 한 번에 메시지를 받아 볼 방 수. 크론 한 번의 시간 안에 끝나야 합니다. */
const MAX_ROOMS = 20;
/** 평소에는 최근에 움직인 방만 봅니다. 15분마다 오늘 방 전체를 다시 훑습니다(놓친 것 줍기). */
const RECENT_MS = 20 * 60 * 1000;

const CHAT_LIST_QUERY = `query giaChatList($organizationId: ID!, $input: ChatFeedInput) {
  node(id: $organizationId, type: ORGANIZATION) { id ... on Organization { id chats(input: $input) { edges { node { id label unreadMessageCount lastActiveAt isArchived } } } } }
}`;
const MESSAGES_QUERY = `query giaMessages($chatId: ID!) {
  node(id: $chatId, type: CHAT) { id ... on Chat { id messagesV2 { edges { node { id label type createdAt createdBy { id firstName lastName type } } } } } }
}`;

type Node = { id: string; label?: string | null; type?: string | null; createdAt?: string | null; createdBy?: { firstName?: string | null; lastName?: string | null; type?: string | null } | null };

export function toddleServerConfigured(): boolean {
  return !!process.env.TODDLE_JWT && !!process.env.TODDLE_ORG_ID;
}

class LoginRequired extends Error {}

async function gql<T>(operationName: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tod-source": "WEB", authorization: `Bearer ${process.env.TODDLE_JWT}` },
    body: JSON.stringify([{ operationName, variables, extensions: {}, query }]),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as unknown;
  const one = (Array.isArray(json) ? json[0] : json) as { data?: T; errors?: { message: string }[] } | null;
  const errText = one?.errors?.map((e) => e.message).join(" | ") ?? "";
  if (res.status === 401 || res.status === 403 || (errText && AUTH_ERROR.test(errText))) throw new LoginRequired(errText || `HTTP ${res.status}`);
  if (errText) throw new Error(`토들 응답 오류: ${errText.slice(0, 200)}`);
  if (!one?.data) throw new Error(`토들 응답이 비어 있습니다(HTTP ${res.status}).`);
  return one.data;
}

function kstMidnightMs(now = Date.now()): number {
  const KST = 9 * 3600_000;
  return Math.floor((now + KST) / 86400000) * 86400000 - KST;
}

const isStaff = (n: Node | undefined | null) => String(n?.createdBy?.type ?? "").toUpperCase() === "STAFF";
const nameOf = (n: Node | undefined | null) => [n?.createdBy?.firstName, n?.createdBy?.lastName].filter(Boolean).join(" ") || null;

async function heartbeat(supabase: SupabaseClient, status: string, detail: string) {
  const { error } = await supabase.from("integration_heartbeats").upsert({
    key: "toddle-collector",
    last_seen_at: new Date().toISOString(),
    status,
    detail: `서버 수집 · ${detail}`.slice(0, 300),
    updated_at: new Date().toISOString(),
  });
  if (error) await logApiError(supabase, "toddle-server:heartbeat", error);
}

export type ToddleServerResult = { ok: boolean; rooms: number; saved: number; replied: number; error?: string };

export async function collectToddleServer(supabase: SupabaseClient): Promise<ToddleServerResult> {
  if (!toddleServerConfigured()) return { ok: false, rooms: 0, saved: 0, replied: 0, error: "TODDLE_JWT·TODDLE_ORG_ID 가 없습니다." };
  const since = kstMidnightMs();
  const now = Date.now();
  // 15분마다(정각·15·30·45분) 오늘 방 전체, 그 밖에는 최근 20분 안에 움직인 방만.
  const fullScan = new Date(now).getUTCMinutes() % 15 === 0;
  try {
    type ListData = { node?: { chats?: { edges?: { node?: { id: string; label?: string | null; lastActiveAt?: string | null; isArchived?: boolean } }[] } } };
    const list = await gql<ListData>("giaChatList", CHAT_LIST_QUERY, { organizationId: process.env.TODDLE_ORG_ID, input: { first: 100 } });
    const rooms = (list.node?.chats?.edges ?? [])
      .map((e) => e.node)
      .filter((n): n is NonNullable<typeof n> => !!n && !!n.id && !n.isArchived && !!n.lastActiveAt)
      .filter((n) => new Date(n.lastActiveAt!).getTime() >= (fullScan ? since : Math.max(since, now - RECENT_MS)))
      .sort((a, b) => new Date(b.lastActiveAt!).getTime() - new Date(a.lastActiveAt!).getTime())
      .slice(0, MAX_ROOMS);

    // 원문으로 가는 주소의 앞부분(학교 경로). 따로 적어 두지 않았으면 확장 수집기가 남긴 주소에서 떼어 씁니다.
    let base = (process.env.TODDLE_WEB_BASE ?? "").replace(/\/$/, "");
    if (!base) {
      const { data: last } = await supabase
        .from("pickup_requests")
        .select("source_url")
        .eq("source", "토들")
        .like("source_url", "%/messaging/%")
        .order("received_at", { ascending: false })
        .limit(1);
      const u = (last?.[0]?.source_url as string | undefined) ?? "";
      base = u.split("/messaging/")[0] ?? "";
    }
    const items: IngestInput[] = [];
    const replies: { ref: string; at: string; by: string | null }[] = [];
    for (const room of rooms) {
      try {
        type MsgData = { node?: { messagesV2?: { edges?: { node?: Node }[] } } };
        const data = await gql<MsgData>("giaMessages", MESSAGES_QUERY, { chatId: room.id });
        const all = (data.node?.messagesV2?.edges ?? [])
          .map((e) => e.node)
          .filter((m): m is Node => !!m && (!m.type || String(m.type).toUpperCase() === "NORMAL"))
          .filter((m) => !!m.createdAt && new Date(m.createdAt).getTime() >= since)
          .sort((x, y) => new Date(x.createdAt!).getTime() - new Date(y.createdAt!).getTime());
        all.forEach((m, i) => {
          if (isStaff(m) || !m.label?.trim()) return;
          const answer = all.slice(i + 1).find(isStaff) ?? null;
          items.push({
            source: "토들",
            sourceRef: String(m.id),
            channelLabel: room.label ?? null,
            senderName: nameOf(m),
            text: m.label,
            receivedAt: m.createdAt ?? room.lastActiveAt ?? null,
            chatId: room.id,
            sourceUrl: base ? `${base}/messaging/${room.id}` : null,
            staffReply: answer?.createdAt ? { at: answer.createdAt, by: nameOf(answer) } : null,
          });
          if (answer?.createdAt) replies.push({ ref: String(m.id), at: answer.createdAt, by: nameOf(answer) });
        });
      } catch (err) {
        if (err instanceof LoginRequired) throw err;
        // 한 방이 실패해도 나머지는 계속합니다. 다음 회차(1분 뒤)에 다시 봅니다.
        await logApiError(supabase, "toddle-server:room", err);
      }
    }

    // 이미 저장한 글은 건너뜁니다. 답글 표시는 아직 답함이 아닌 줄에만 겁니다.
    const refs = items.map((i) => i.sourceRef!).filter(Boolean);
    const known = new Map<string, string | null>();
    for (let i = 0; i < refs.length; i += 200) {
      const { data, error } = await supabase
        .from("pickup_requests")
        .select("source_ref, replied_at")
        .eq("source", "토들")
        .in("source_ref", refs.slice(i, i + 200));
      if (error) throw new Error(`저장된 글을 읽지 못했습니다: ${error.message}`);
      for (const r of data ?? []) known.set(r.source_ref as string, (r.replied_at as string | null) ?? null);
    }

    let replied = 0;
    for (const r of replies) {
      if (!known.has(r.ref) || known.get(r.ref)) continue;
      const { data, error } = await supabase
        .from("pickup_requests")
        .update({ replied_at: r.at, replied_by: r.by, replied_via: "토들 답글" })
        .eq("source", "토들")
        .eq("source_ref", r.ref)
        .is("replied_at", null)
        .select("id");
      if (error) await logApiError(supabase, "toddle-server:reply", error);
      replied += data?.length ?? 0;
    }

    const fresh = items.filter((i) => !known.has(i.sourceRef!));
    let saved = 0;
    if (fresh.length > 0) {
      const roster = await loadRoster(supabase);
      // 글마다 AI 분류가 돌아 시간이 걸립니다. 크론 한 번(30초) 안에 끝나게 8건씩, 남은 것은 다음 회차에.
      for (const item of fresh.slice(0, 8)) {
        try {
          await ingestPickup(supabase, item, roster);
          saved += 1;
        } catch (err) {
          // 저장 못 한 글은 다음 회차에 다시 «새 글»로 잡힙니다(아직 표에 없으므로).
          await logApiError(supabase, "toddle-server:ingest", err);
        }
      }
    }
    if (saved > 0 || replied > 0) await notifyRefreshFromServer();

    await heartbeat(
      supabase,
      "ok",
      saved > 0 ? `${saved}건 보냄 (본 방 ${rooms.length}개${fullScan ? " · 전체 훑기" : ""})` : `새 메시지 없음 (본 방 ${rooms.length}개${fullScan ? " · 전체 훑기" : ""})`,
    );
    return { ok: true, rooms: rooms.length, saved, replied };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof LoginRequired) {
      await heartbeat(supabase, "login_required", `토들 열쇠(TODDLE_JWT)가 만료됐거나 틀렸습니다. 새 열쇠를 넣어 주세요. (${msg.slice(0, 80)})`);
    } else {
      await heartbeat(supabase, "error", msg);
      await logApiError(supabase, "toddle-server", err);
    }
    return { ok: false, rooms: 0, saved: 0, replied: 0, error: msg };
  }
}
