"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// 진단 화면 위쪽 도구줄.
//
// 담당자: "만약에 고친 거라면 진단도 다시 진단하기 버튼 만들어줘야 해."
//
// 맞습니다. 고치고 나서 결과를 보려면 브라우저 새로고침을 눌러야 했는데, 그건 "이 화면이
// 다시 재보는 것"이 아니라 "브라우저가 페이지를 다시 여는 것"이라 같은 일인지 확신이 안
// 섭니다. 여기서 누르면 서버가 실제로 다시 재고, 몇 시에 쟀는지가 남습니다.

export default function DiagnosticsToolbar({ measuredAt }: { measuredAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastAt, setLastAt] = useState<string | null>(null);

  function recheck() {
    startTransition(() => {
      router.refresh();
      setLastAt(new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={recheck}
        disabled={pending}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "다시 재는 중…" : "🔄 다시 진단하기"}
      </button>
      <span className="text-[11px] text-slate-400">
        {lastAt ? `${lastAt}에 다시 쟀습니다` : `${measuredAt} 기준`}
      </span>
    </div>
  );
}
