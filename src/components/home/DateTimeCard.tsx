"use client";

import { useEffect, useState } from "react";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 서버(SSR)와 클라이언트의 "지금 시각"이 다를 수 있어 hydration 불일치를 막기 위해,
// 마운트되기 전까지는 아무것도 그리지 않고 클라이언트에서 계산한 값만 사용합니다.
export default function DateTimeCard() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [viewOffset, setViewOffset] = useState(0); // 표시 중인 달의 현재 달 대비 오프셋(0=이번 달)

  useEffect(() => {
    setMounted(true);
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!mounted || !now) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="h-40 animate-pulse rounded-lg bg-slate-50" />
      </div>
    );
  }

  const timeStr = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const weekdayStr = WEEKDAYS[now.getDay()] + "요일";

  const viewDate = new Date(now.getFullYear(), now.getMonth() + viewOffset, 1);
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-center">
        <div className="text-2xl font-bold tabular-nums text-slate-800">{timeStr}</div>
        <div className="mt-1 text-sm font-semibold text-slate-600">{dateStr}</div>
        <div className="text-xs text-slate-400">{weekdayStr}</div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => setViewOffset((v) => v - 1)}
          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100"
          aria-label="이전 달"
        >
          ‹
        </button>
        <div className="text-xs font-semibold text-slate-600">
          {viewYear}년 {viewMonth + 1}월
        </div>
        <button
          onClick={() => setViewOffset((v) => v + 1)}
          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100"
          aria-label="다음 달"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={"font-semibold " + (i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-400")}>
            {w}
          </div>
        ))}
        {cells.map((day, idx) => {
          const isToday = isCurrentMonth && day === now.getDate();
          const col = idx % 7;
          return (
            <div key={idx} className="flex items-center justify-center py-0.5">
              {day && (
                <span
                  className={
                    "flex h-6 w-6 items-center justify-center rounded-full " +
                    (isToday
                      ? "bg-blue-600 font-bold text-white"
                      : col === 0
                      ? "text-red-400"
                      : col === 6
                      ? "text-blue-400"
                      : "text-slate-600")
                  }
                >
                  {day}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
