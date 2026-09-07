"use client";

import { useCallback, useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/version";

/**
 * 예전 버전 화면을 쓰고 있는 사람에게 새로고침을 권합니다.
 *
 * 브라우저는 한 번 받아둔 코드를 계속 씁니다. 탭을 켜둔 채 며칠 일하는 분들이 실제로 있어서,
 * 고쳐놓은 것이 그 화면에서는 그대로 안 고쳐진 채 남습니다. 더 나쁜 것은 **본인은 최신인 줄
 * 안다**는 점입니다 — 화면 어디에도 «지금 보고 있는 것이 어제 코드»라는 표시가 없습니다.
 * 「고쳤다는데 안 되는데요」의 상당수가 이것이었습니다.
 *
 * ── 왜 저절로 새로고침하지 않는가 ──
 *
 * 사무실 대형 모니터(운영 대시보드)는 아무도 안 보고 있으므로 스스로 새로고침합니다.
 * 그런데 이 화면은 **사람이 손을 대고 있는 중**입니다. 메모를 쓰다가, 인보이스를 고르다가
 * 화면이 새로 뜨면 하던 것이 날아갑니다. 그래서 알리기만 하고 누르는 것은 사람이 합니다.
 *
 * ── 되돌아간 버전에는 조르지 않습니다 ──
 *
 * 배포가 여러 곳에 퍼지는 중에는 서버가 잠깐 옛 버전을 돌려줄 수 있습니다. 그때 «새로고침
 * 하세요»가 뜨면, 눌러도 아무것도 안 바뀌는 안내가 됩니다. 서버 쪽이 **더 높을 때만** 띄웁니다.
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

const CHECK_MS = 3 * 60 * 1000;

export default function VersionUpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { version?: string };
      if (j.version && isNewer(j.version, APP_VERSION)) setLatest(j.version);
    } catch {
      // 인터넷이 끊겼거나 배포 중일 수 있습니다. 다음 차례에 다시 봅니다 -
      // 여기서 오류를 띄우면 «연결 끊김» 안내와 겹쳐 두 번 놀라게 됩니다.
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

  if (!latest || hidden) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-[195] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-amber-950 print:!hidden">
      <span>
        새 버전 <b>v{latest}</b> 이 올라왔습니다 — 지금 보고 계신 화면은 v{APP_VERSION} 입니다.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-amber-950 px-3 py-0.5 text-[11px] font-bold text-amber-50 hover:bg-amber-900"
      >
        새로고침
      </button>
      {/* 지금 당장 못 누르는 상황이 있습니다(작성 중). 닫을 수 있게 두되, 이 탭에서만
          숨깁니다 - 다음에 열면 다시 뜹니다. 「나중에 하겠다」가 「영영 안 한다」가 되면
          안내를 없앤 것과 같습니다. */}
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="text-[11px] font-medium text-amber-900/80 underline decoration-dotted"
      >
        나중에
      </button>
    </div>
  );
}
