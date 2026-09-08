"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { unmatchedMentions, type ChatMember } from "@/lib/chatMention";
import type { GoogleChatMirrorMessage } from "@/lib/types";

/**
 * 구글챗 **여러 방**을 이 화면에서 읽고 답합니다.
 *
 * ── 왜 이 자리에 있나 ────────────────────────────────────────────────
 *
 * 직원들은 구글챗과 토들을 띄워놓고 일합니다. 그래서 업무화면을 놓을 자리가 없고, 자리가
 * 없으니 더 안 쓰게 됩니다. 읽기만 되면 답할 때마다 구글챗을 열어야 해서 창이 하나도 줄지
 * 않습니다 - 읽고 답하는 것까지 여기서 돼야 창 하나를 실제로 닫습니다.
 *
 * ── 왜 아래로 쌓나 ───────────────────────────────────────────────────
 *
 * 인박스의 다른 칸(출결알림)은 «오늘 처리할 것을 훑는 곳»이라 새 것이 위로 옵니다. 여기는
 * **대화하는 곳**이라 구글챗과 같은 순서로 둡니다 - 오간 순서가 뒤집히면 무슨 이야기의
 * 답인지 읽을 수 없습니다.
 */

type SpaceRow = {
  google_space_id: string;
  display_name: string | null;
  source_key: string | null;
  enabled: boolean;
  sort_order: number;
  last_polled_at: string | null;
  last_error: string | null;
};

type Attachment = { name: string; contentType: string | null; path: string | null; why?: string };

const SEEN_KEY = "gia-chat-rooms-seen-v1";

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (same(d, today)) return "오늘";
  if (same(d, yest)) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

/**
 * 구글챗과 **같은 모양**으로 그립니다.
 *
 * 직원들은 하루 종일 구글챗을 봅니다. 우리 화면이 다른 모양이면 같은 글을 두 번 읽는 셈이
 * 되고, 그러면 「구글챗에서 보는 게 빠르다」로 돌아갑니다. 모양이 같아야 눈이 옮겨옵니다.
 *
 * 다만 글자는 작게 둡니다 - 여기는 인박스 한 칸이지 창 전체가 아닙니다.
 */

/** 이름에서 만든 동그라미 색. 같은 사람은 늘 같은 색이라야 눈이 먼저 알아봅니다. */
const AVATAR_COLORS = ["#1e8e3e", "#7b1fa2", "#c5221f", "#1a73e8", "#e37400", "#00838f", "#5f6368"];
function avatarOf(name: string): { letter: string; color: string } {
  const n = (name || "?").trim();
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return { letter: n.charAt(0).toUpperCase() || "?", color: AVATAR_COLORS[h % AVATAR_COLORS.length] };
}

type Span = { start: number; length: number; name?: string | null };

/**
 * 본문을 **멘션 칩**과 글자로 나눕니다.
 *
 * 구글챗이 알려준 구간(mentions)을 그대로 씁니다. 없으면 `@이름` 을 글자로 찾습니다 - 그
 * 칸이 생기기 전에 들어온 줄은 좌표가 없습니다. 추측이라 표시는 옅게 합니다.
 */
function renderBody(text: string, spans: Span[] | null | undefined, meNames: string[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const isMe = (n: string) => meNames.some((m) => m && n.toLowerCase().includes(m.toLowerCase()));
  const chip = (label: string, key: string, exact: boolean) => (
    <span
      key={key}
      className={
        "mx-0.5 inline-block rounded px-1 align-baseline text-[11px] font-semibold " +
        (isMe(label)
          ? "bg-blue-600 text-white"
          : exact
            ? "bg-blue-50 text-blue-700"
            : "text-blue-600")
      }
    >
      {label}
    </span>
  );

  const valid = (spans ?? []).filter((s) => s.start >= 0 && s.length > 0 && s.start + s.length <= text.length);
  if (valid.length > 0) {
    let at = 0;
    valid.sort((a, b) => a.start - b.start);
    for (const [i, sp] of valid.entries()) {
      if (sp.start > at) out.push(text.slice(at, sp.start));
      out.push(chip(text.slice(sp.start, sp.start + sp.length), `m${i}`, true));
      at = sp.start + sp.length;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  }

  // 좌표가 없는 옛 줄 - 글자로 찾습니다. 어디까지가 성함인지 **추측**이라 옅게 그립니다.
  const re = /@[^\s@]+(?:\s[A-Z][^\s@]*)?/g;
  let last = 0;
  let hit: RegExpExecArray | null;
  let k = 0;
  while ((hit = re.exec(text))) {
    if (hit.index > last) out.push(text.slice(last, hit.index));
    out.push(chip(hit[0], `g${k++}`, false));
    last = hit.index + hit[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length > 0 ? out : [text];
}

export default function GoogleChatRooms({ messages, currentUserName }: { messages: GoogleChatMirrorMessage[]; currentUserName: string | null }) {
  const notify = useToast();
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<Record<string, ChatMember[]>>({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<Record<string, number>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSpaces = useCallback(async () => {
    const res = await fetch("/api/google-chat/spaces");
    const body = (await res.json().catch(() => ({}))) as { spaces?: SpaceRow[]; error?: string };
    // 조용히 비워두지 않습니다 - 방이 없는 것인지 못 읽은 것인지 화면이 말해야 합니다.
    if (!res.ok) return setSpaceError(body.error ?? "방 목록을 읽지 못했습니다.");
    setSpaceError(null);
    setSpaces(body.spaces ?? []);
  }, []);

  useEffect(() => {
    void loadSpaces();
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      if (raw) setSeen(JSON.parse(raw) as Record<string, number>);
    } catch {
      /* 시크릿 모드 - 이번 세션만 기억 못 해도 동작에는 문제 없습니다 */
    }
  }, [loadSpaces]);

  const rooms = useMemo(() => (spaces ?? []).filter((s) => s.enabled).sort((a, b) => a.sort_order - b.sort_order), [spaces]);

  useEffect(() => {
    if (!active && rooms.length > 0) setActive(rooms[0].google_space_id);
  }, [rooms, active]);

  // 지금 보고 있는 방의 사람 목록(@멘션용). 방을 바꿀 때마다 한 번만 읽습니다.
  useEffect(() => {
    if (!active || members[active]) return;
    void (async () => {
      const { data, error } = await createClient()
        .from("google_chat_members")
        .select("google_user_id, display_name")
        .eq("google_space_id", active);
      if (error) {
        console.error("[구글챗] 사람 목록을 못 읽었습니다:", error.message);
        return;
      }
      setMembers((p) => ({ ...p, [active]: (data as ChatMember[] | null) ?? [] }));
    })();
  }, [active, members]);

  const items = useMemo(
    () =>
      messages
        .filter((m) => m.google_space_id === active)
        // 구글챗과 같은 순서 - 오래된 것이 위, 새 것이 아래.
        .sort((a, b) => a.created_at_google.localeCompare(b.created_at_google)),
    [messages, active],
  );

  // 새 메시지가 오면 맨 아래로. 다만 위를 읽고 있을 때는 끌어내리지 않습니다.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [items.length, active]);

  // 본 것으로 칩니다.
  useEffect(() => {
    if (!active) return;
    setSeen((p) => {
      const next = { ...p, [active]: Date.now() };
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        /* 위와 같음 */
      }
      return next;
    });
  }, [active, items.length]);

  // 사진 주소. 비공개 보관함이라 볼 때마다 짧게 사는 주소를 받습니다. **보이는 것만** 받습니다.
  useEffect(() => {
    const need = items
      .flatMap((m) => ((m as { attachments?: Attachment[] | null }).attachments ?? []).map((a) => a.path))
      .filter((p): p is string => !!p && !photoUrls[p]);
    if (need.length === 0) return;
    let alive = true;
    void (async () => {
      const { data, error } = await createClient().storage.from("chat-attachments").createSignedUrls(need, 60 * 60);
      if (error) {
        console.error("[구글챗] 사진 주소를 못 받았습니다:", error.message);
        return;
      }
      if (!alive) return;
      setPhotoUrls((prev) => {
        const next = { ...prev };
        for (const r of data ?? []) if (r.path && r.signedUrl) next[r.path] = r.signedUrl;
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [items, photoUrls]);

  async function toggleRoom(id: string, enabled: boolean) {
    setBusy(true);
    const res = await fetch("/api/google-chat/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", spaceId: id, enabled }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return notify(body.error ?? "바꾸지 못했습니다.", "error");
    await loadSpaces();
  }

  /** 아는 방을 한 번에 켜고 끕니다. 한 방이 실패해도 나머지는 계속 바꿉니다. */
  async function toggleAll(enabled: boolean) {
    const list = (spaces ?? []).filter((r) => r.enabled !== enabled);
    if (list.length === 0) return;
    setBusy(true);
    const failed: string[] = [];
    for (const r of list) {
      const res = await fetch("/api/google-chat/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", spaceId: r.google_space_id, enabled }),
      });
      if (!res.ok) failed.push(r.display_name ?? r.google_space_id);
    }
    setBusy(false);
    // 조용히 넘어가지 않습니다 - 「켰는데 안 켜졌다」가 가장 찾기 어렵습니다.
    if (failed.length > 0) notify(`못 바꾼 방: ${failed.join(", ")}`, "error");
    else notify(enabled ? `방 ${list.length}개를 켰습니다.` : `방 ${list.length}개를 껐습니다.`, "success");
    await loadSpaces();
  }

  async function refreshRooms() {
    setBusy(true);
    const res = await fetch("/api/google-chat/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; found?: number; added?: number };
    setBusy(false);
    if (!res.ok) return notify(body.error ?? "방 목록을 받지 못했습니다.", "error");
    notify(`방 ${body.found ?? 0}개를 찾았습니다(새로 ${body.added ?? 0}개).`, "success");
    await loadSpaces();
  }

  async function send() {
    const text = reply.trim();
    if (!text || !active) return;

    // 부를 수 없는 이름은 **보내기 전에** 알려줍니다. 글자로만 나가면 보낸 쪽은 불렀다고
    // 생각하고 받는 쪽은 알림을 못 받습니다.
    const missed = unmatchedMentions(text, members[active] ?? []);
    if (missed.length > 0) {
      const ok = window.confirm(
        `${missed.map((n) => `@${n}`).join(", ")} — 이 이름은 이 방에서 못 찾았습니다.\n그냥 글자로 나가고 알림은 가지 않습니다. 그래도 보낼까요?`,
      );
      if (!ok) return;
    }

    setSending(true);
    const res = await fetch("/api/google-chat/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId: active, text }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setSending(false);
    if (!res.ok) return notify(body.error ?? "보내지 못했습니다.", "error");
    setReply("");
    notify("보냈습니다.", "success");
  }

  /** `@` 를 치면 이 방 사람 목록이 뜹니다. 번호를 사람이 외울 수는 없습니다. */
  const mentionHits = useMemo(() => {
    const m = /@([^\s@]*)$/.exec(reply);
    if (!m || !active) return [];
    const k = m[1].toLowerCase().replace(/\s+/g, "");
    return (members[active] ?? [])
      .filter((x) => x.display_name && (k === "" || x.display_name.toLowerCase().replace(/\s+/g, "").includes(k)))
      .slice(0, 6);
  }, [reply, members, active]);

  function pickMention(name: string) {
    setReply((r) => r.replace(/@[^\s@]*$/, `@${name} `));
    inputRef.current?.focus();
  }

  /**
   * 새 글이 오면 **그 자리에서 알립니다.**
   *
   * 방이 여럿이 되면서, 지금 보고 있지 않은 방에 온 글은 탭 위 빨간 숫자로만 남았습니다.
   * 숫자는 눈이 그쪽을 볼 때만 보입니다 - 다른 일을 하고 있으면 몇십 분이 그냥 지나갑니다.
   *
   * 처음 그릴 때는 알리지 않습니다. 열자마자 지난 글 수십 건이 한꺼번에 뜨면 알림이 아니라
   * 소음이고, 소음이 되면 그다음부터는 아무도 안 봅니다.
   */
  const knownIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (knownIdsRef.current === null) {
      knownIdsRef.current = new Set(messages.map((m) => m.id));
      return;
    }
    const known = knownIdsRef.current;
    const fresh = messages.filter((m) => !known.has(m.id));
    for (const m of messages) known.add(m.id);
    if (fresh.length === 0) return;

    const nameOf = (id: string | null) =>
      (spaces ?? []).find((r) => r.google_space_id === id)?.display_name ?? "구글챗";
    // 여러 건이 한꺼번에 오면 한 줄로 묶습니다.
    if (fresh.length > 2) {
      notify(`💬 새 메시지 ${fresh.length}건 (${[...new Set(fresh.map((m) => nameOf(m.google_space_id)))].join(", ")})`, "info");
      return;
    }
    for (const m of fresh) {
      const body = (m.content ?? "").replace(/\s+/g, " ").slice(0, 60) || "(사진)";
      notify(`💬 ${nameOf(m.google_space_id)} · ${m.sender_display_name ?? "구글챗"}: ${body}`, "info");
    }
  }, [messages, spaces, notify]);

  const activeRoom = rooms.find((r) => r.google_space_id === active) ?? null;

  // 나를 부른 멘션은 진하게 칠합니다. 방에 멘션이 대여섯 개씩 붙어 있어서, 다 같은 색이면
  // **내가 불린 줄을 못 찾습니다.**
  const meNames = useMemo(() => (currentUserName ? [currentUserName] : []), [currentUserName]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 방 고르기 줄 */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-black/5 px-2 py-1.5">
        {rooms.map((r) => {
          const last = messages.filter((m) => m.google_space_id === r.google_space_id);
          const unread = last.filter((m) => new Date(m.created_at_google).getTime() > (seen[r.google_space_id] ?? 0)).length;
          return (
            <button
              key={r.google_space_id}
              type="button"
              onClick={() => setActive(r.google_space_id)}
              title={r.last_error ? `이 방을 읽지 못하고 있습니다: ${r.last_error}` : undefined}
              className={
                "relative flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
                (active === r.google_space_id ? "bg-indigo-500 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
              }
            >
              {r.last_error ? "🔴" : "💬"} {r.display_name || "이름 없는 방"}
              {unread > 0 && active !== r.google_space_id && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black leading-none text-white shadow">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setPicker((p) => !p)}
          title="볼 방 고르기"
          className="ml-auto shrink-0 rounded-full bg-black/5 px-2 py-1 text-[11px] text-slate-500 hover:bg-black/10"
        >
          ⚙
        </button>
      </div>

      {/* 방 고르기 - 켜기는 사람이 합니다. 계정이 든 방을 전부 비추면 인박스가 남의 대화로 덮입니다. */}
      {picker && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-black/5 bg-slate-50 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-600">볼 방 고르기</span>
            <button
              onClick={() => void refreshRooms()}
              disabled={busy}
              className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-black/10 disabled:opacity-40"
            >
              {busy ? "…" : "🔄 구글에서 방 목록 받기"}
            </button>
            {/* 방이 대여섯 개면 하나씩 켜는 것이 일입니다. 다만 **끄기도 한 번에** 둡니다 -
                한 번에 켜는 길만 있으면 되돌리는 데 다섯 번 눌러야 합니다. */}
            <button
              onClick={() => void toggleAll(true)}
              disabled={busy || (spaces ?? []).length === 0}
              className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 disabled:opacity-40"
            >
              모두 켜기
            </button>
            <button
              onClick={() => void toggleAll(false)}
              disabled={busy || (spaces ?? []).length === 0}
              className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-black/10 disabled:opacity-40"
            >
              모두 끄기
            </button>
          </div>
          {spaceError && <p className="mb-1 text-[10px] text-red-500">{spaceError}</p>}
          {(spaces ?? []).length === 0 && !spaceError && (
            <p className="py-2 text-center text-[10px] text-slate-400">아직 아는 방이 없습니다. 위 버튼으로 목록을 받아보세요.</p>
          )}
          {(spaces ?? []).map((s) => (
            <label key={s.google_space_id} className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={s.enabled}
                disabled={busy}
                onChange={(e) => void toggleRoom(s.google_space_id, e.target.checked)}
              />
              <span className="truncate">{s.display_name || s.google_space_id}</span>
              {s.last_error && <span className="ml-auto shrink-0 text-[9px] text-red-500">읽기 실패</span>}
            </label>
          ))}
        </div>
      )}

      {/* 대화 */}
      {rooms.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3 text-center text-[11px] leading-relaxed opacity-50">
          {spaceError ?? "보고 있는 방이 없습니다. ⚙ 에서 방을 골라주세요."}
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-1.5">
          {items.length === 0 && <p className="py-6 text-center text-[11px] text-slate-400">아직 가져온 메시지가 없습니다.</p>}
          {items.map((m, i) => {
            const prev = i > 0 ? items[i - 1] : null;
            const newDay = !prev || new Date(prev.created_at_google).toDateString() !== new Date(m.created_at_google).toDateString();
            // 같은 사람이 이어서 쓴 것은 이름과 얼굴을 다시 그리지 않습니다 - 구글챗과 같은 모양.
            const sameSender = !newDay && prev?.sender_display_name === m.sender_display_name;
            const mine = !!currentUserName && m.sender_display_name === currentUserName;
            const files = ((m as { attachments?: Attachment[] | null }).attachments ?? []) as Attachment[];
            const av = avatarOf(m.sender_display_name || "구글챗");
            // 안 읽은 줄 - 구글챗과 같은 자리에 같은 선을 긋습니다. 어디부터 새로 온 것인지가
            // 목록에서 가장 먼저 알고 싶은 것입니다.
            const seenAt = active ? (seen[active] ?? 0) : 0;
            const firstUnread =
              seenAt > 0 &&
              new Date(m.created_at_google).getTime() > seenAt &&
              (!prev || new Date(prev.created_at_google).getTime() <= seenAt);
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-1.5 flex items-center gap-2">
                    <div className="h-px flex-1 bg-black/5" />
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {dayLabel(m.created_at_google)}
                    </span>
                    <div className="h-px flex-1 bg-black/5" />
                  </div>
                )}
                {firstUnread && (
                  <div className="my-1 flex items-center gap-1.5">
                    <div className="h-px flex-1 bg-blue-400" />
                    <span className="text-[9px] font-bold text-blue-600">여기부터 새 글</span>
                    <div className="h-px flex-1 bg-blue-400" />
                  </div>
                )}
                <div className="flex gap-1.5">
                  {/* 얼굴 자리 - 같은 사람이 이어 쓰면 비워둡니다(줄이 붙어 보입니다). */}
                  <span className="w-6 shrink-0 pt-0.5">
                    {!sameSender && (
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: av.color }}
                        title={m.sender_display_name ?? undefined}
                      >
                        {av.letter}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    {!sameSender && (
                      <span className="flex items-baseline gap-1.5">
                        <span className={"text-[11px] font-bold " + (mine ? "text-indigo-600" : "text-slate-800")}>
                          {m.sender_display_name || "구글챗"}
                        </span>
                        <span className="text-[9px] text-slate-400">{timeStr(m.created_at_google)}</span>
                      </span>
                    )}
                    {m.content && (
                      // 회색 말풍선. 구글챗과 같은 모양이라 눈이 옮겨 앉는 데 시간이 안 걸립니다.
                      <span className="mt-0.5 inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl bg-slate-100 px-2 py-1 text-[11px] leading-relaxed text-slate-800">
                        {renderBody(m.content, m.mentions, meNames)}
                      </span>
                    )}
                {files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 pl-0.5">
                    {files.map((f, k) => {
                      const isImage = (f.contentType ?? "").startsWith("image/");
                      const url = f.path ? photoUrls[f.path] : null;
                      // 못 가져온 것은 **그렇다고 말합니다.** 빈칸으로 두면 사진이 없었던
                      // 것인지 못 가져온 것인지 아무도 모릅니다.
                      if (!f.path) {
                        return (
                          <span key={k} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                            📎 {f.name} — {f.why ?? "가져오지 못했습니다"}
                          </span>
                        );
                      }
                      if (isImage && url) {
                        return (
                          // eslint-disable-next-line @next/next/no-img-element -- 서명 주소라 next/image 대상이 아닙니다.
                          <a key={k} href={url} target="_blank" rel="noreferrer" className="block">
                            <img src={url} alt={f.name} className="max-h-32 rounded border border-black/10 object-cover" />
                          </a>
                        );
                      }
                      return (
                        <a
                          key={k}
                          href={url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200"
                        >
                          📎 {f.name}
                        </a>
                      );
                    })}
                  </div>
                )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 답장 */}
      {activeRoom && (
        <div className="relative shrink-0 border-t border-black/5 p-1.5">
          {mentionHits.length > 0 && (
            <div className="absolute bottom-full left-1.5 z-20 mb-1 w-52 overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg">
              {mentionHits.map((h) => (
                <button
                  key={h.google_user_id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(h.display_name as string);
                  }}
                  className="block w-full px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-indigo-50"
                >
                  @{h.display_name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
              }}
              placeholder={`${activeRoom.display_name || "이 방"}에 답장 · @로 사람 부르기`}
              className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-[11px]"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !reply.trim()}
              className="shrink-0 rounded bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-30"
            >
              {sending ? "…" : "보내기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
