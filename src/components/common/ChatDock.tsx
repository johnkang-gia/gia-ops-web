"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GoogleChatMirrorMessage } from "@/lib/types";

/**
 * **구글챗 서랍 손잡이** — 화면 오른쪽 가장자리에 늘 붙어 있는 탭.
 *
 * 담임선생님과의 대화는 구글챗에서 계속 이어져야 해서, 행정실은 운영앱과 구글챗을 번갈아 봐야 했습니다. 구글챗을
 * 운영앱 화면 안에 iframe 으로 넣는 것은 구글이 403 으로 막습니다(다른 사이트 안에 끼워지는 것을 서버가 거부).
 * 크롬 **사이드패널**은 확장 프로그램만 열 수 있습니다. 그래서:
 *
 *   ① **「GIA 구글챗 패널」 확장**(파일 6개, 이 앱이 zip 으로 내려줌)이 깔려 있으면 손잡이가 확장에 «열어 달라»고 신호를
 *      보내고, 진짜 chat.google.com 이 크롬 오른쪽 사이드패널에서 열립니다. 로그인은 그 사람 크롬 계정 그대로.
 *   ② 확장이 없으면 손잡이가 **설치 안내**를 띄웁니다(내려받기 → 압축 풀기 → chrome://extensions → 불러오기). 설치가
 *      되면 안내 창이 스스로 「확인됨」으로 바뀝니다 - 확장의 bridge.js 가 <html data-gia-chat-panel="버전"> 을 남깁니다.
 *   ③ 설치하지 않겠다고 고르면 **오른쪽에 붙인 작은 창**(팝업)으로 엽니다. 다시 누르면 앞으로 가져옵니다.
 *
 * 손잡이의 숫자는 **마지막으로 연 뒤에 들어온 글 수**(거울 표 기준)입니다. 운영앱이 받아 두는 방만 셉니다.
 */

const SEEN_KEY = "gia-chat-seen-at";
const NOTIFY_KEY = "gia-chat-notify";
const MODE_KEY = "gia-chat-mode"; // "popup" 이면 확장 없이도 묻지 않고 창으로
const POPUP_NAME = "gia-google-chat";
const ZIP_URL = "/chatpanel/gia-chat-panel.zip";

function extVersion(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute("data-gia-chat-panel");
}

export default function ChatDock({ me }: { me: string }) {
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<GoogleChatMirrorMessage | null>(null);
  const [notify, setNotify] = useState(false);
  const [ext, setExt] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const seenRef = useRef<string>("");
  const popupRef = useRef<Window | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    seenRef.current = localStorage.getItem(SEEN_KEY) ?? new Date().toISOString();
    setNotify(localStorage.getItem(NOTIFY_KEY) === "1");
  }, []);

  // 확장이 있는지. bridge.js 는 document_idle 에 붙어서 처음 몇 초는 없다가 생길 수 있고, 안내 창을 열어 둔 채 설치하면
  // 새로고침 뒤에야 붙습니다. 가벼운 속성 읽기라 계속 봐도 됩니다.
  useEffect(() => {
    const tick = () => setExt(extVersion());
    tick();
    const t = window.setInterval(tick, 1500);
    return () => window.clearInterval(t);
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

  const flash = useCallback((msg: string) => {
    setHint(msg);
    window.setTimeout(() => setHint(null), 7000);
  }, []);

  /** 오른쪽에 붙인 작은 창. 이미 열려 있으면 앞으로. */
  const openPopup = useCallback(() => {
    markSeen();
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
    if (!win) flash("팝업이 막혔습니다. 주소창 오른쪽의 팝업 차단 아이콘에서 허용해 주세요.");
  }, [markSeen, flash]);

  /** 확장에 «사이드패널 열어줘». 600ms 안에 답이 없거나 실패하면 창으로. */
  const openPanel = useCallback(() => {
    markSeen();
    let done = false;
    const onAck = (e: MessageEvent) => {
      if (e.source !== window || !e.data) return;
      if (e.data.gia === "chatOpened") done = true;
      else if (e.data.gia === "chatFailed") {
        done = true;
        flash(`사이드패널을 못 열어 창으로 엽니다 (${String(e.data.error ?? "")}). 확장을 새로 고쳤다면 이 화면을 새로고침하세요.`);
        openPopup();
      }
    };
    window.addEventListener("message", onAck);
    // origin-ok: 같은 창 안의 확장 다리(bridge.js)에 보내는 신호입니다. 남에게 건네는 주소가 아닙니다.
    window.postMessage({ gia: "openChat" }, window.location.origin);
    window.setTimeout(() => {
      window.removeEventListener("message", onAck);
      if (done) return;
      flash("확장이 답하지 않아 창으로 엽니다. 확장을 방금 설치·갱신했다면 이 화면을 새로고침하세요.");
      openPopup();
    }, 600);
  }, [markSeen, flash, openPopup]);

  const onHandle = useCallback(() => {
    if (ext) return openPanel();
    if (localStorage.getItem(MODE_KEY) === "popup") return openPopup();
    setGuide(true);
  }, [ext, openPanel, openPopup]);

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
    <>
      <div className="fixed right-0 top-1/2 z-[60] -translate-y-1/2 print:hidden">
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={onHandle}
            title={latest ? `최근: ${latest.sender_display_name ?? ""} · ${(latest.content ?? "").slice(0, 60)}` : ext ? "구글챗을 사이드패널로 열기" : "구글챗 열기 (확장 설치 안내)"}
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
          {!ext && (
            <button
              type="button"
              onClick={() => setGuide(true)}
              className="rounded-l-lg border border-r-0 border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 shadow"
              title="사이드패널 확장이 아직 없습니다 - 설치 안내"
            >
              설치
            </button>
          )}
        </div>
        {hint && <div className="absolute right-full top-0 mr-2 w-64 rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] text-white shadow-lg">{hint}</div>}
      </div>
      {guide && (
        <InstallGuide
          ext={ext}
          onClose={() => setGuide(false)}
          onOpenPanel={() => {
            setGuide(false);
            openPanel();
          }}
          onPopup={(remember) => {
            if (remember) localStorage.setItem(MODE_KEY, "popup");
            setGuide(false);
            openPopup();
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function isMac() {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");
}

function InstallGuide({ ext, onClose, onOpenPanel, onPopup }: { ext: string | null; onClose: () => void; onOpenPanel: () => void; onPopup: (remember: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const [remember, setRemember] = useState(false);
  const mac = isMac();

  async function copyAddr() {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: "확장 파일 내려받기",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <a href={ZIP_URL} download="gia-chat-panel.zip" className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-slate-900">
            ⬇ gia-chat-panel.zip 내려받기
          </a>
          <span className="text-[11px] text-slate-500">파일 6개짜리 작은 확장입니다. 토들·수집과는 상관없고 구글챗을 여는 일만 합니다.</span>
        </div>
      ),
    },
    {
      title: "압축 풀기 → 「GIA구글챗패널」 폴더를 지우지 않을 곳에 두기",
      body: (
        <p>
          {mac ? "내려받기 폴더에서 zip 을 두 번 누르면 「GIA구글챗패널」 폴더가 생깁니다." : "zip 에 오른쪽 클릭 › 「압축 풀기」. 「GIA구글챗패널」 폴더가 생깁니다."}{" "}
          크롬은 이 폴더를 <b>그 자리에서</b> 계속 읽습니다. 문서 폴더처럼 지우지 않을 곳으로 옮겨 두세요. 폴더를 지우면 확장도 사라집니다.
        </p>
      ),
    },
    {
      title: "크롬 확장 프로그램 화면 열기",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-slate-100 px-2 py-1 text-[12px]">chrome://extensions</code>
          <button type="button" onClick={() => void copyAddr()} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50">
            {copied ? "복사됨 ✓" : "주소 복사"}
          </button>
          <span className="text-[11px] text-slate-500">웹페이지에서는 이 주소를 바로 열 수 없어서, 복사해 주소창에 붙여 넣으세요.</span>
        </div>
      ),
    },
    {
      title: "오른쪽 위 「개발자 모드」 켜기",
      body: <p>확장 프로그램 화면 오른쪽 위의 스위치입니다. 켜면 왼쪽 위에 「압축해제된 확장 프로그램을 로드합니다」 단추가 나타납니다.</p>,
    },
    {
      title: "「압축해제된 확장 프로그램을 로드합니다」 → 「GIA구글챗패널」 폴더 고르기",
      body: (
        <p>
          폴더 <b>안</b>이 아니라 폴더 <b>자체</b>를 고릅니다. 목록에 「GIA 구글챗 패널 1.0.0」 카드가 생기고 스위치가 켜져 있으면 됩니다.
          {!mac && " 윈도우는 크롬을 다시 켤 때 「개발자 모드 확장 프로그램 사용 중지」 창이 뜰 수 있는데, 「취소」를 누르면 그대로 씁니다."}
        </p>
      ),
    },
    {
      title: "이 화면 새로고침 → 손잡이 누르기",
      body: (
        <p>
          새로고침하면 아래 상태가 「확인됨」으로 바뀝니다. 그다음부터 「💬 구글챗」 손잡이를 누르면 크롬 오른쪽 사이드패널에 구글챗이 열립니다.
          처음 한 번은 패널 안에서 로그인 화면이 나올 수 있는데, 패널 위 「새 탭 ↗」으로 한 번 로그인한 뒤 「↻」를 누르면 그 뒤로는 유지됩니다.
        </p>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-[640px] max-w-full overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-800">💬 구글챗을 크롬 사이드패널로 열기</h2>
            <p className="mt-1 text-[12px] text-slate-500">
              구글은 자기 화면이 다른 사이트 안에 끼워지는 것을 막아서, 운영앱 안에는 넣을 수 없습니다. 대신 크롬 자체의 오른쪽
              사이드패널에 띄웁니다 - 그건 작은 확장 프로그램 하나가 있어야 합니다. 컴퓨터마다 한 번만 하면 됩니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="닫기">
            ✕
          </button>
        </div>

        <div className={"mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] " + (ext ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800")}>
          {ext ? (
            <>
              <span className="font-bold">✓ 확장 확인됨 (v{ext})</span>
              <button type="button" onClick={onOpenPanel} className="ml-auto rounded-md bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-700">
                사이드패널 열기 →
              </button>
            </>
          ) : (
            <span>
              <span className="font-bold">아직 확장이 보이지 않습니다.</span> 설치한 뒤 이 화면을 새로고침하면 여기가 「확인됨」으로 바뀝니다.
            </span>
          )}
        </div>

        <ol className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[12px] font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-slate-700">
                <div className="font-bold text-slate-800">{s.title}</div>
                <div className="mt-0.5">{s.body}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-[12px]">
          <button type="button" onClick={() => onPopup(remember)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            설치하지 않고 작은 창으로 열기
          </button>
          <label className="flex items-center gap-1 text-slate-500">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            다음부터 묻지 않고 창으로
          </label>
          <span className="ml-auto text-[11px] text-slate-400">마음이 바뀌면 손잡이 아래 「설치」를 누르면 됩니다.</span>
        </div>
      </div>
    </div>
  );
}
