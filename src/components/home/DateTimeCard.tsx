"use client";

import { useEffect, useMemo, useState } from "react";
import { getHolidayPreset } from "@hyunbinseo/holidays-kr";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAC_EPOCH_SECONDS = Date.UTC(2001, 0, 1) / 1000;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

// 날짜를 클릭하면 각 OS의 기본 캘린더 앱과 연동합니다.
// - Mac/iOS: Calendar.app의 calshow: URL 스킴으로 해당 날짜를 바로 엽니다.
// - 그 외(Windows/Android 등): .ics 파일을 만들어 다운로드합니다. 열어보면(더블클릭) 기본
//   캘린더 앱(Outlook/캘린더/구글 캘린더 등)에서 바로 추가할 수 있습니다 - 웹에서 흔히 쓰이는
//   "캘린더에 추가" 표준 방식입니다.
function openInNativeCalendar(dateStr: string, title: string) {
  const [y, m, d] = dateStr.split("-").map(Number);

  if (isApplePlatform()) {
    const targetSeconds = Date.UTC(y, m - 1, d) / 1000;
    const macSeconds = Math.floor(targetSeconds - MAC_EPOCH_SECONDS);
    window.location.href = `calshow:${macSeconds}`;
    return;
  }

  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextStr = `${next.getUTCFullYear()}${pad2(next.getUTCMonth() + 1)}${pad2(next.getUTCDate())}`;
  const compact = `${y}${pad2(m)}${pad2(d)}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GIA Ops//KO",
    "BEGIN:VEVENT",
    `UID:${compact}-${Date.now()}@gia-ops-web`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact}`,
    `DTEND;VALUE=DATE:${nextStr}`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${dateStr}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 서버(SSR)와 클라이언트의 "지금 시각"이 다를 수 있어 hydration 불일치를 막기 위해,
// 마운트되기 전까지는 아무것도 그리지 않고 클라이언트에서 계산한 값만 사용합니다.
export default function DateTimeCard() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [viewOffset, setViewOffset] = useState(0); // 표시 중인 달의 현재 달 대비 오프셋(0=이번 달)
  const [holidays, setHolidays] = useState<Record<string, string[]>>({});

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

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-center">
        <div className="text-2xl font-bold tabular-nums text-slate-800">{timeStr}</div>
        <div className="mt-1 text-sm font-semibold text-slate-600">{dateStr}</div>
        <div className="text-xs text-slate-400">
          {weekdayStr}
          {todayHoliday ? ` · ${todayHoliday}` : ""}
        </div>
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
          {vYear}년 {vMonth + 1}월
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
          const dateKey = day ? `${vYear}-${pad2(vMonth + 1)}-${pad2(day)}` : null;
          const holidayNames = dateKey ? holidays[dateKey] : undefined;
          const isHoliday = !!holidayNames?.length;
          return (
            <div key={idx} className="flex items-center justify-center py-0.5">
              {day && dateKey && (
                <button
                  onClick={() => openInNativeCalendar(dateKey, holidayNames?.join(" · ") ?? "GIA 학사 일정")}
                  title={holidayNames?.join(" · ") ?? "클릭하면 캘린더 앱에서 열립니다"}
                  className={
                    "flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-slate-100 " +
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
