"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GoogleChatMirrorMessage } from "@/lib/types";

/**
 * **구글챗 서랍 손잡이** — 화면 오른쪽 가장자리에 늘 붙어 있는 탭.
 *
 * 담임선생님과의 대화는 구글챗에서 계속 이어져야 해서, 행정실은 운영앱과 구글챗을 번갈아 봐야 했습니다. 구글챗을
 * 운영앱 안에 그대로 넣는 길은 둘입니다.
 *
 *   ① **크롬 사이드패널**(수집기 확장 2.7+): 진짜 chat.google.com 이 브라우저 오른쪽에서 열립니다. 로그인은 그 사람
 *      크롬 계정 그대로, 쓰고 답하는 것도 그 사람 이름으로. 이 손잡이를 누르면 확장에 «열어 달라»고 신호를 보냅니다.
 *   ② 확장이 없거나 답이 없으면 **오른쪽에 붙인 작은 창**(팝업)으로 엽니다. 한 번 열린 창은 다시 누르면 앞으로
 *      가져옵니다.
 *
 * 운영앱 화면 안에 iframe 으로 넣지 않는 이유: 구글이 다른 사이트 안에 끼워 넣는 것을 막습니다(X-Frame-Options).
 * 확장은 그 머리글을 벗겨 낼 수 있어서 사이드패널 안에서는 됩니다.
 *
 * 손잡이의 숫자는 **마지막으로 연 뒤에 들어온 글 수**(거울 표 기준)입니다. 운영앱이 받아 두는 방만 셉니다 - 거울에
 * 안 들어오는 방의 글은 못 셉니다. 사이드패널·창을 열면 0이 됩니다.
 */

const SEEN_KEY = "gia-chat-seen-at";
const NOTIFY_KEY = "gia-chat-notify";
const POPUP_NAME = "gia-google-chat";

export default function ChatDock({ me }: { me: string }) {
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<GoogleChatMirrorMessage | null>(null);
  const [notify, setNotify] = useState(false);
  const seenRef = useRef<string>("");
  const popupRef = useRef<Window | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    seenRef.current = localStorage.getItem(SEEN_KEY) ?? new Date().toISOString();
    setNotify(localStorage.getItem(NOTIFY_KEY) === "1");
  }, []);

  // 마지막으로 연 뒤 들어온 글 수 + 실시간.
  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    const isMine = (m: GoogleChatMirrorMessage) =>
      (m.sender_email ?? "").toLowerCase() === me.toLowerCase() || /^\[[^\]]+\]/.test(m.content ?? "");
    async function load() {
      const { data } = await supabase
        .from("google_chat_mirror_messages")
        .select("id, source_key, google_message_id, google_space_id, sender_display_name, sender_email, content, created_at_google, received_at, task_id, mentions, attachments")
        .gt("received_at", seenRef.current)
        .order("received_at", { ascending: false })
        .limit(50);
      if (!alive) return;
      const rows = ((data as GoogleChatMirrorMessage[] | null) ?? []).filter((m) => !isMine(m));
      setUnread(rows.length);
      setLatest(rows[0] ?? null);
    }
    void load();
    const ch = supabase
      .channel("chat-dock")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "google_chat_mirror_messages" }, (p) => {
        const m = p.new as GoogleChatMirrorMessage;
        if (isMine(m)) return;
        setUnread((n) => n + 1);
        setLatest(m);
        if (localStorage.getItem(NOTIFY_KEY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(`💬 ${m.sender_display_name ?? "구글챗"}`, { body: (m.content ?? "").slice(0, 120), tag: `gia-chat-${m.id}` });
          } catch {
            /* 알림을 못 띄워도 손잡이 숫자는 올라갑니다 */
          }
        }
      })
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(ch);
    };
  }, [me]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    seenRef.current = now;
    localStorage.setItem(SEEN_KEY, now);
    setUnread(0);
  }, []);

  /** 확장에 «사이드패널 열어줘». 400ms 안에 답이 없으면 창으로. */
  const open = useCallback(() => {
    markSeen();
    let acked = false;
    const onAck = (e: MessageEvent) => {
      if (e.source === window && e.data && e.data.gia === "chatOpened") acked = true;
    };
    window.addEventListener("message", onAck);
    // origin-ok: 같은 창 안의 확장 다리(bridge.js)에 보내는 신호입니다. 남에게 건네는 주소가 아닙니다.
    window.postMessage({ gia: "openChat" }, window.location.origin);
    window.setTimeout(() => {
      window.removeEventListener("message", onAck);
      if (acked) return;
      // 확장이 없거나 답이 없습니다 - 오른쪽에 붙인 창으로.
      const w = 440;
      const h = Math.max(600, window.screen.availHeight - 80);
      const left = Math.max(0, (window.screen.availWidth ?? window.innerWidth) - w - 8);
      const feat = `popup=yes,width=${w},height=${h},left=${left},top=40,resizable=yes,scrollbars=yes`;
      const existing = popupRef.current;
      if (existing && !existing.closed) {
        existing.focus();
        return;
      }
      const win = window.open("https://chat.google.com/", POPUP_NAME, feat);
      popupRef.current = win;
      if (!win) setHint("팝업이 막혔습니다. 주소창 오른쪽의 팝업 차단 아이콘에서 허용해 주세요.");
      else setHint("확장 2.7 이상을 깔면 창 대신 크롬 사이드패널로 열립니다(관리 › 연동 상태).");
      window.setTimeout(() => setHint(null), 6000);
    }, 400);
  }, [markSeen]);

  async function toggleNotify() {
    if (!notify) {
      if (typeof Notification === "undefined") return;
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    const next = !notify;
    setNotify(next);
    localStorage.setItem(NOTIFY_KEY, next ? "1" : "0");
  }

  return (
    <div className="fixed right-0 top-1/2 z-[60] -translate-y-1/2 print:hidden">
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={open}
          title={latest ? `최근: ${latest.sender_display_name ?? ""} · ${(latest.content ?? "").slice(0, 60)}` : "구글챗 열기"}
          className={
            "flex items-center gap-1 rounded-l-xl border border-r-0 px-2 py-2 text-[12px] font-bold shadow-lg transition " +
            (unread > 0 ? "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")
          }
        >
          <span style={{ writingMode: "vertical-rl" }}>💬 구글챗</span>
          {unread > 0 && <span className="rounded-full bg-white px-1.5 text-[11px] text-emerald-700">{unread > 99 ? "99+" : unread}</span>}
        </button>
        <button
          type="button"
          onClick={() => void toggleNotify()}
          className={"rounded-l-lg border border-r-0 px-1.5 py-0.5 text-[10px] shadow " + (notify ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400")}
          title={notify ? "새 구글챗 글이 오면 바탕화면 알림을 띄웁니다(끄기)" : "새 구글챗 글이 오면 바탕화면 알림(켜기)"}
        >
          {notify ? "🔔" : "🔕"}
        </button>
      </div>
      {hint && <div className="absolute right-full top-0 mr-2 w-56 rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] text-white shadow-lg">{hint}</div>}
    </div>
  );
}
