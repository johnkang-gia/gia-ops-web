"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getHolidayPreset } from "@hyunbinseo/holidays-kr";
import { createClient } from "@/lib/supabase/client";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// compact=true면 왼쪽 사이드바에 항상 붙어있는 축소판(작은 글씨/좁은 칸/테두리 없음)으로,
// compact=false(기본값)면 기존처럼 카드형 큰 위젯으로 그립니다. 기능(달력 이동, 공휴일 표시)은
// 두 모드 모두 동일합니다.
// 예전에는 날짜를 누르면 OS 기본 캘린더 앱을 여는 기능이었는데, 실제로는 잘 동작하지 않는
// 환경이 많았고(요청: "OS캘린더 안뜨더라고") 이 위젯 자체가 학사일정 달력과 연동된 미리보기라
// 날짜든 달력 어디를 누르든 학사일정 페이지로 바로 이동하도록 단순화했습니다. 기존의 별도
// "학사일정 보기" 링크 버튼은 이제 중복이라 제거했습니다.
export default function DateTimeCard({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [viewOffset, setViewOffset] = useState(0); // 표시 중인 달의 현재 달 대비 오프셋(0=이번 달)
  const [holidays, setHolidays] = useState<Record<string, string[]>>({});
  // 학사일정 연동 - 이 달력이 "우리 메인 달력"이라, 학사일정(학기 시작/종료 전 준비할 일)이
  // 있는 날짜에 작은 점을 함께 표시합니다(요청: "그 달력이 우리 메인의 달력과 연동되었으면").
  const [checklistDates, setChecklistDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const viewYear = useMemo(() => {
    if (!now) return null;
    return new Date(now.getFullYear(), now.getMonth() + viewOffset, 1).getFullYear();
  }, [now, viewOffset]);

  const viewMonth = useMemo(() => {
    if (!now) return null;
    return new Date(now.getFullYear(), now.getMonth() + viewOffset, 1).getMonth();
  }, [now, viewOffset]);

  useEffect(() => {
    if (!viewYear) return;
    let cancelled = false;
    // 대한민국 공식 월력요항 기반 공휴일 데이터(우주항공청). 데이터가 없는 연도는 조용히
    // 무시합니다(달력 기능 자체에는 영향 없음).
    getHolidayPreset(String(viewYear))
      .then((preset) => {
        if (!cancelled) setHolidays(preset as Record<string, string[]>);
      })
      .catch(() => {
        if (!cancelled) setHolidays({});
      });
    return () => {
      cancelled = true;
    };
  }, [viewYear]);

  useEffect(() => {
    if (viewYear === null || viewMonth === null) return;
    let cancelled = false;
    const monthPrefix = `${viewYear}-${pad2(viewMonth + 1)}`;
    const supabase = createClient();
    supabase
      .from("academic_checklist_items")
      .select("due_date")
      .gte("due_date", `${monthPrefix}-01`)
      .lte("due_date", `${monthPrefix}-31`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as { due_date: string }[] | null) ?? [];
        setChecklistDates(new Set(rows.map((r) => r.due_date)));
      });
    return () => {
      cancelled = true;
    };
  }, [viewYear, viewMonth]);

  if (!mounted || !now) {
    return compact ? (
      <div className="h-16 animate-pulse rounded-lg bg-slate-50" />
    ) : (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="h-40 animate-pulse rounded-lg bg-slate-50" />
      </div>
    );
  }

  // compact(사이드바)에서도 초 단위까지 표시합니다.
  const timeStr = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = compact
    ? now.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })
    : now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const weekdayStr = WEEKDAYS[now.getDay()] + "요일";
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const todayHoliday = holidays[todayKey]?.join(" · ");

  const viewDate = new Date(now.getFullYear(), now.getMonth() + viewOffset, 1);
  const vYear = viewDate.getFullYear();
  const vMonth = viewDate.getMonth();
  const firstWeekday = new Date(vYear, vMonth, 1).getDay();
  const daysInMonth = new Date(vYear, vMonth + 1, 0).getDate();
  const isCurrentMonth = vYear === now.getFullYear() && vMonth === now.getMonth();

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const cellSize = compact ? "h-3.5 w-3.5 text-[7px]" : "h-6 w-6";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push("/academic-calendar")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") router.push("/academic-calendar");
      }}
      onMouseEnter={() => router.prefetch("/academic-calendar")}
      title="클릭하면 학사일정으로 이동합니다"
      className={
        "cursor-pointer " +
        (compact ? "bg-transparent" : "rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50")
      }
    >
      <div className={compact ? "mb-0.5 text-center" : "mb-3 text-center"}>
        <div className={compact ? "text-[11px] font-bold tabular-nums text-slate-800" : "text-2xl font-bold tabular-nums text-slate-800"}>
          {timeStr}
        </div>
        <div className={compact ? "text-[8px] font-semibold text-slate-500" : "mt-1 text-sm font-semibold text-slate-600"}>
          {dateStr} {compact ? `(${weekdayStr[0]})` : ""}
        </div>
        {!compact && (
          <div className="text-xs text-slate-400">
            {weekdayStr}
            {todayHoliday ? ` · ${todayHoliday}` : ""}
          </div>
        )}
        {compact && todayHoliday && <div className="text-[7px] font-semibold text-red-500">{todayHoliday}</div>}
      </div>

      <div className={compact ? "mb-0.5 flex items-center justify-between" : "mb-2 flex items-center justify-between"}>
        {/* 달력 어디를 눌러도 학사일정으로 이동하는 카드 위에 얹혀 있어서, 이전/다음 달 버튼은
            그 클릭이 카드 클릭으로 번지지(bubbling) 않도록 stopPropagation을 꼭 걸어야
            "달만 넘기려고 눌렀는데 화면이 이동해버리는" 문제가 안 생깁니다. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setViewOffset((v) => v - 1);
          }}
          className={"rounded text-slate-400 hover:bg-slate-100 " + (compact ? "px-1 text-[8px]" : "px-1.5 py-0.5 text-xs")}
          aria-label="이전 달"
        >
          ‹
        </button>
        <div className={compact ? "text-[8px] font-semibold text-slate-600" : "text-xs font-semibold text-slate-600"}>
          {vYear}년 {vMonth + 1}월
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setViewOffset((v) => v + 1);
          }}
          className={"rounded text-slate-400 hover:bg-slate-100 " + (compact ? "px-1 text-[8px]" : "px-1.5 py-0.5 text-xs")}
          aria-label="다음 달"
        >
          ›
        </button>
      </div>

      <div className={"grid grid-cols-7 text-center " + (compact ? "gap-y-0 text-[7px]" : "gap-y-1 text-[11px]")}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={"font-semibold " + (i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-400")}>
            {compact ? w[0] : w}
          </div>
        ))}
        {cells.map((day, idx) => {
          const isToday = isCurrentMonth && day === now.getDate();
          const col = idx % 7;
          const dateKey = day ? `${vYear}-${pad2(vMonth + 1)}-${pad2(day)}` : null;
          const holidayNames = dateKey ? holidays[dateKey] : undefined;
          const isHoliday = !!holidayNames?.length;
          const hasChecklist = !!(dateKey && checklistDates.has(dateKey));
          return (
            <div key={idx} className={"relative flex items-center justify-center " + (compact ? "py-0" : "py-0.5")}>
              {day && dateKey && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push("/academic-calendar");
                  }}
                  title={
                    [holidayNames?.join(" · "), hasChecklist ? "📅 학사일정 있음" : null].filter(Boolean).join(" · ") ||
                    "클릭하면 학사일정으로 이동합니다"
                  }
                  className={
                    "flex items-center justify-center rounded-full transition hover:bg-slate-100 " +
                    cellSize +
                    " " +
                    (isToday
                      ? "bg-blue-600 font-bold text-white hover:bg-blue-600"
                      : isHoliday
                      ? "font-bold text-red-500"
                      : col === 0
                      ? "text-red-400"
                      : col === 6
                      ? "text-blue-400"
                      : "text-slate-600")
                  }
                >
                  {day}
                </button>
              )}
              {hasChecklist && (
                <span
                  className={
                    "pointer-events-none absolute rounded-full bg-emerald-500 " +
                    (compact ? "bottom-0 h-[3px] w-[3px]" : "bottom-0.5 h-1 w-1")
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
