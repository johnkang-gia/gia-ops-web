"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { labelOf, scrubPath, type UsageEventIn } from "@/lib/usageTrack";

/**
 * **화면을 열고 닫은 것을 기록합니다.**
 *
 * ── 어떻게 세나 ─────────────────────────────────────────────────────────────
 *
 * 주소가 바뀔 때마다 **앞 화면의 머문 시간**을 확정해 보냅니다. 「열었다」만 세면 잘못
 * 들어갔다가 바로 나온 것과 이십 분을 들여다본 것이 똑같이 한 번이 됩니다.
 *
 * 탭을 닫거나 다른 앱으로 넘어갈 때도(`visibilitychange` · `pagehide`) 마지막 한 줄을
 * 보냅니다. `sendBeacon` 을 쓰는 이유는, 창이 닫히는 중에는 평범한 `fetch` 가 그냥
 * 취소되기 때문입니다 - 그러면 **가장 오래 머문 화면의 시간이 늘 빠집니다.**
 *
 * ── 왜 모아서 보내나 ────────────────────────────────────────────────────────
 *
 * 화면을 옮길 때마다 바로 보내면 한 사람이 하루에 수백 번 요청을 만듭니다. 몇 초 모았다가
 * 한 번에 보냅니다 - 다만 창이 닫힐 때는 모아둔 것을 **그 자리에서** 털어 보냅니다.
 */

const FLUSH_MS = 5000;

function newSessionId(): string {
  try {
    const KEY = "gia:usage:sid";
    const cur = sessionStorage.getItem(KEY);
    if (cur) return cur;
    const sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(KEY, sid);
    return sid;
  } catch {
    // 저장소를 못 쓰는 브라우저(사생활 보호 모드)에서도 기록은 되어야 합니다. 그 경우
    // 화면을 옮길 때마다 새 세션으로 세어지는데, 아예 안 세는 것보다는 낫습니다.
    return `${Date.now().toString(36)}-nostore`;
  }
}

export default function UsageTracker() {
  const pathname = usePathname();
  const queue = useRef<UsageEventIn[]>([]);
  const sid = useRef<string>("");
  const enteredAt = useRef<number>(Date.now());
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    sid.current = newSessionId();
  }, []);

  useEffect(() => {
    function flush(useBeacon = false) {
      const events = queue.current;
      if (events.length === 0) return;
      queue.current = [];
      const body = JSON.stringify({ events });
      try {
        if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/usage", new Blob([body], { type: "application/json" }));
          return;
        }
        void fetch("/api/usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* 기록을 못 보내도 사람이 하던 일은 계속됩니다. */
      }
    }

    // ① 앞 화면을 닫습니다(머문 시간 확정).
    if (lastPath.current && lastPath.current !== pathname) {
      const p = scrubPath(lastPath.current);
      queue.current.push({
        session_id: sid.current,
        kind: "view",
        path: p,
        label: labelOf(p),
        duration_ms: Date.now() - enteredAt.current,
      });
    }
    lastPath.current = pathname;
    enteredAt.current = Date.now();

    const timer = window.setInterval(() => flush(false), FLUSH_MS);

    function onLeave() {
      // 지금 보고 있는 화면도 닫아서 함께 보냅니다. 안 그러면 **가장 오래 머문 화면**의
      // 시간이 늘 빠집니다 - 사람은 마지막 화면에 오래 있다가 탭을 닫으니까요.
      const p = scrubPath(lastPath.current ?? "/");
      queue.current.push({
        session_id: sid.current,
        kind: "view",
        path: p,
        label: labelOf(p),
        duration_ms: Date.now() - enteredAt.current,
      });
      enteredAt.current = Date.now();
      flush(true);
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") onLeave();
      else enteredAt.current = Date.now();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
      flush(false);
    };
  }, [pathname]);

  return null;
}
