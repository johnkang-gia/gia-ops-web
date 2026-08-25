"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WorkTabs from "./WorkTabs";

export type ActionCard = { key: string; label: string; count: number; tone: string; icon: string; href: string };
export type RecentItem = { label: string; date: string };

function useCountUp(target: number, ms = 600) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function ActionTile({ card }: { card: ActionCard }) {
  const n = useCountUp(card.count);
  const router = useRouter();
  const hot = card.count > 0;
  return (
    <button
      type="button"
      onClick={() => router.push(card.href)}
      onMouseEnter={() => router.prefetch(card.href)}
      className={
        "group flex items-center gap-3 rounded-2xl border bg-white p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md " +
        (hot ? "border-slate-200" : "border-slate-100 opacity-70")
      }
    >
      <span className="text-2xl">{card.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-slate-500">{card.label}</div>
        <div className="text-2xl font-extrabold tabular-nums" style={{ color: hot ? card.tone : "#94a3b8" }}>{n}</div>
      </div>
      {hot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: card.tone }} />}
    </button>
  );
}

const STATUS_TONE: Record<string, string> = { 예정: "#64748b", 진행중: "#2563eb", 보류: "#d97706" };

export default function WorkOverviewClient({
  term,
  actions,
  statusCounts,
  completedToday,
  chatToday,
  recents,
}: {
  term: { label: string; dday: number | null } | null;
  actions: ActionCard[];
  statusCounts: Record<string, number>;
  completedToday: number;
  chatToday: number;
  recents: { incidents: RecentItem[]; meetings: RecentItem[]; events: RecentItem[] };
}) {
  const router = useRouter();
  const totalOpen = (statusCounts["예정"] ?? 0) + (statusCounts["진행중"] ?? 0) + (statusCounts["보류"] ?? 0);
  const maxStatus = Math.max(1, ...Object.values(statusCounts));
  const totalAction = actions.reduce((s, a) => s + a.count, 0);

  const fmt = (d: string) => (d ? d.slice(5).replace("-", "/") : "");

  return (
    <div className="mx-auto max-w-6xl">
      <WorkTabs />

      {/* 상단 배너: 학기 + 오늘 확인할 것 요약 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-blue-200 bg-blue-50/50 px-4 py-2.5">
        {term && <span className="text-sm font-extrabold text-blue-800">📚 {term.label}</span>}
        {term?.dday != null && (
          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
            {term.dday > 0 ? `학기말 D-${term.dday}` : term.dday === 0 ? "오늘 학기말" : "학기 종료"}
          </span>
        )}
        <span className={"text-xs font-semibold " + (totalAction > 0 ? "text-red-600" : "text-slate-500")}>
          오늘 확인할 것 {totalAction}건
        </span>
        {chatToday > 0 && (
          <button onClick={() => router.push("/work")} className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            💬 오늘 구글챗 {chatToday}
          </button>
        )}
      </div>

      {/* 오늘 확인·처리할 것 */}
      <div className="mb-3">
        <div className="mb-1.5 text-xs font-bold text-slate-600">오늘 확인·처리할 것</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {actions.map((a) => <ActionTile key={a.key} card={a} />)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.4fr]">
        {/* 업무 현황 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <b className="text-sm">업무 현황</b>
            <span className="text-[11px] text-slate-400">진행 {totalOpen} · 오늘 완료 {completedToday}</span>
          </div>
          <div className="flex flex-col gap-2">
            {(["예정", "진행중", "보류"] as const).map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs font-semibold text-slate-600">{s}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className="flex h-full items-center justify-end rounded pr-1.5 text-[10px] font-bold text-white transition-all duration-700"
                    style={{ width: `${((statusCounts[s] ?? 0) / maxStatus) * 100}%`, background: STATUS_TONE[s], minWidth: (statusCounts[s] ?? 0) > 0 ? 20 : 0 }}
                  >
                    {(statusCounts[s] ?? 0) > 0 ? statusCounts[s] : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => router.push("/work")} className="mt-3 w-full rounded-lg bg-blue-50 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
            업무 보드 열기 →
          </button>
        </div>

        {/* 최근 기록 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-sm">최근 기록</b>
            <button onClick={() => router.push("/ops")} className="text-[11px] text-blue-600 hover:underline">전체 기록 →</button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <RecentCol title="📋 사건" items={recents.incidents} href="/records" onGo={router.push} fmt={fmt} />
            <RecentCol title="💬 회의" items={recents.meetings} href="/meetings" onGo={router.push} fmt={fmt} />
            <RecentCol title="🎉 행사" items={recents.events} href="/events" onGo={router.push} fmt={fmt} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentCol({ title, items, href, onGo, fmt }: { title: string; items: RecentItem[]; href: string; onGo: (h: string) => void; fmt: (d: string) => string }) {
  return (
    <div>
      <button onClick={() => onGo(href)} className="mb-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">{title}</button>
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-300">기록 없음</p>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <span className="shrink-0 rounded bg-slate-50 px-1 py-0.5 text-[9px] font-semibold text-slate-400">{fmt(it.date)}</span>
              <span className="min-w-0 truncate text-slate-600">{it.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
