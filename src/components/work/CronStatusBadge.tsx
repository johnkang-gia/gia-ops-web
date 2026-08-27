"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { INTEGRATIONS } from "@/lib/heartbeat";

// 크론 연동 상태를 업무보드 상단에 초록불·빨간불 숫자로 요약합니다.
//
// 담당자: "오른쪽에 초록색불과 숫자, 빨간색불과 숫자 이런 식으로 크론 연동을 한눈에 볼 수
//          있게 만들어줘."
//
// 관리 → 연동 상태 화면이 자세한 판이라면, 이건 **매일 보는 자리에 놓는 요약**입니다.
// 문제는 자세히 보러 들어가야만 알 수 있으면 아무도 안 본다는 것입니다. 업무보드는 하루에
// 몇 번씩 여는 화면이라, 여기 숫자가 있으면 눈에 걸립니다.
//
// 누르면 자세한 화면으로 갑니다.

const POLL_MS = 60_000;

function inOfficeHours(): boolean {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const d = kst.getDay();
  const h = kst.getHours();
  return d >= 1 && d <= 5 && h >= 7 && h < 19;
}

export default function CronStatusBadge() {
  const [counts, setCounts] = useState<{ ok: number; bad: number; badLabels: string[] } | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      const { data } = await createClient().from("integration_heartbeats").select("key, last_seen_at, status");
      if (stopped) return;
      const byKey = new Map((data ?? []).map((b) => [b.key as string, b]));
      let ok = 0;
      const badLabels: string[] = [];
      for (const spec of INTEGRATIONS) {
        // 근무시간에만 도는 것은 밤중에 조용해도 정상이라 아예 세지 않습니다.
        if (spec.officeHoursOnly && !inOfficeHours()) continue;
        const b = byKey.get(spec.key);
        const last = (b?.last_seen_at as string | null) ?? null;
        const late = !last || Date.now() - new Date(last).getTime() > spec.everyMinutes * 60 * 1000 * 3;
        if (late) badLabels.push(spec.label);
        else ok += 1;
      }
      setCounts({ ok, bad: badLabels.length, badLabels });
    }
    void load();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  if (!counts) return null;

  return (
    <a
      href="/admin/integrations"
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-black/5 px-2 py-1 text-[11px] text-slate-500 transition hover:bg-black/10"
      title={
        counts.bad > 0
          ? `멈춘 연동: ${counts.badLabels.join(", ")} — 눌러서 자세히 보기`
          : "모든 연동이 정상입니다 — 눌러서 자세히 보기"
      }
    >
      <span className="text-[9px]">🟢</span>
      <span className="tabular-nums font-semibold">{counts.ok}</span>
      {/* 빨간 숫자는 0이면 아예 안 그립니다. 0이 늘 떠 있으면 눈이 그 자리를 무시하게 되고,
          정작 1이 됐을 때도 안 보입니다. */}
      {counts.bad > 0 && (
        <>
          <span className="ml-0.5 text-[9px]">🔴</span>
          <span className="tabular-nums font-bold text-red-600">{counts.bad}</span>
        </>
      )}
    </a>
  );
}
