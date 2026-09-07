"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION } from "@/lib/version";

/**
 * 낡은 화면을 최신으로 되돌립니다 — 다만 **조르지 않고**.
 *
 * 브라우저는 한 번 받아둔 코드를 계속 씁니다. 탭을 켜둔 채 며칠 일하는 분들이 실제로 있어서,
 * 고쳐놓은 것이 그 화면에서는 그대로 안 고쳐진 채 남습니다. 더 나쁜 것은 본인은 최신인 줄
 * 안다는 점입니다 — 화면 어디에도 「지금 보고 있는 것이 어제 코드」라는 표시가 없습니다.
 *
 * ── 왜 배포할 때마다 띄우지 않는가 ──
 *
 * 앞 판은 서버 버전이 화면 버전보다 높기만 하면 노란 띠를 띄웠습니다. 그런데 하루에도 배포가
 * 여러 번 나가는 날이 있어서, 일하는 중에 계속 「새로고침하세요」가 떴습니다.
 *
 * **잦은 안내는 읽히지 않습니다.** 그러면 정작 꼭 새로고침해야 하는 배포(자료가 바뀌었거나
 * 화면이 크게 달라진 경우)에도 아무도 안 누릅니다. 안내를 없앤 것과 같아집니다.
 *
 * 그래서 띠가 뜨는 경우를 둘로 좁혔습니다.
 *
 *   ① **개발자가 확성기를 눌렀을 때.** 알릴 만한 배포인지는 기계가 아니라 사람이 정합니다.
 *   ② **아침 자동 최신화가 그 자리에서 새로고침할 수 없었을 때.** 아래 참고.
 *
 * ── 아침 9시 자동 최신화 ──
 *
 * 대부분의 낡은 화면은 어제 켜둔 탭입니다. 그래서 매일 오전 9시(한국)에 스스로 버전을 보고,
 * 낡았으면 **말없이 새로고침**합니다. 아무 안내도 뜨지 않고 화면만 최신이 됩니다.
 *
 * 단, 그 순간 무언가를 **치고 있으면 새로고침하지 않습니다.** 메모를 쓰다가, 인보이스를
 * 고르다가 화면이 새로 뜨면 하던 것이 날아갑니다. 그때는 띠를 띄워 사람이 고르게 합니다.
 */

/** 0.433.1 같은 값을 숫자로 견줍니다. 글자로 비교하면 0.9 > 0.10 이 됩니다. */
function isNewer(server: string, current: string): boolean {
  const a = server.split(".").map((n) => Number(n) || 0);
  const b = current.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** 지금 사람이 무언가 치고 있는가. 치고 있으면 새로고침으로 날려버리면 안 됩니다. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** 한국 기준 오늘 날짜와 시각. 세계표준시로 재면 9시가 한국 18시가 됩니다. */
function kstNow(): { day: string; hour: number } {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const CHECK_MS = 5 * 60 * 1000;
/** 아침 최신화를 오늘 이미 했는지. 탭마다가 아니라 브라우저에 남겨 새로고침 반복을 막습니다. */
const MORNING_KEY = "giaMorningRefreshDay";
/** 개발자가 보낸 알림을 이 탭에서 닫았는지. 같은 알림으로 두 번 조르지 않습니다. */
const DISMISS_KEY = "giaVersionNoticeDismissed";

type Broadcast = { version: string; note: string | null; at: string };

export default function VersionUpdateBanner() {
  const [notice, setNotice] = useState<Broadcast | null>(null);
  /** 아침 최신화가 「치고 있어서」 못 한 경우. 이때도 띠를 띄웁니다. */
  const [morningPending, setMorningPending] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  // 한 번 새로고침을 걸면 그 뒤 응답이 또 와도 다시 걸지 않습니다.
  const reloading = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { version?: string; broadcast?: Broadcast | null };
      const serverVersion = j.version ?? "";
      const outdated = !!serverVersion && isNewer(serverVersion, APP_VERSION);

      // ① 개발자가 보낸 알림. 내 화면이 그 버전보다 낮을 때만 뜹니다 - 배포가 여러 곳에
      //    퍼지는 중에는 서버가 잠깐 옛 버전을 돌려줄 수 있고, 그때 뜨는 안내는 눌러도
      //    아무것도 안 바뀝니다.
      const b = j.broadcast ?? null;
      if (b && isNewer(b.version, APP_VERSION)) {
        // 이 탭에서 이미 닫은 알림이면 다시 띄우지 않습니다.
        if (sessionStorage.getItem(DISMISS_KEY) !== b.at) setNotice(b);
      } else {
        setNotice(null);
      }

      // ② 아침 자동 최신화. 하루 한 번만.
      if (!outdated || reloading.current) return;
      const { day, hour } = kstNow();
      if (hour < 9) return;
      if (localStorage.getItem(MORNING_KEY) === day) return;

      if (isTyping()) {
        // 치고 있는 중에는 날리지 않습니다. 대신 띠로 알려서 사람이 고르게 합니다.
        setMorningPending(serverVersion);
        return;
      }
      localStorage.setItem(MORNING_KEY, day);
      reloading.current = true;
      window.location.reload();
    } catch {
      // 인터넷이 끊겼거나 배포 중일 수 있습니다. 다음 차례에 다시 봅니다 -
      // 여기서 오류를 띄우면 「연결 끊김」 안내와 겹쳐 두 번 놀라게 됩니다.
    }
  }, []);

  useEffect(() => {
    void check();
    const t = setInterval(() => void check(), CHECK_MS);
    // 다른 일을 하다 돌아왔을 때가 새 버전을 만나기 가장 쉬운 순간입니다.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [check]);

  const showing = notice ?? (morningPending ? { version: morningPending, note: null, at: "" } : null);
  if (!showing || hidden) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-[195] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-amber-950 print:!hidden">
      <span>
        새 버전 <b>v{showing.version}</b> 이 올라왔습니다 — 지금 보고 계신 화면은 v{APP_VERSION} 입니다.
        {/* 왜 눌러야 하는지가 있으면 눌립니다. 「그냥 눌러라」는 안 눌립니다. */}
        {showing.note && <b className="ml-1.5">{showing.note}</b>}
      </span>
      <button
        type="button"
        onClick={() => {
          reloading.current = true;
          window.location.reload();
        }}
        className="rounded-full bg-amber-950 px-3 py-0.5 text-[11px] font-bold text-amber-50 hover:bg-amber-900"
      >
        새로고침
      </button>
      {/* 지금 당장 못 누르는 상황이 있습니다(작성 중). 닫을 수 있게 두되, 이 탭에서만
          숨깁니다 - 다음에 열면 다시 뜹니다. 「나중에 하겠다」가 「영영 안 한다」가 되면
          안내를 없앤 것과 같습니다. */}
      <button
        type="button"
        onClick={() => {
          if (notice?.at) sessionStorage.setItem(DISMISS_KEY, notice.at);
          setHidden(true);
        }}
        className="text-[11px] font-medium text-amber-900/80 underline decoration-dotted"
      >
        나중에
      </button>
    </div>
  );
}
