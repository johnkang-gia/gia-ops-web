"use client";

import { useEffect, useMemo, useState } from "react";
import { getHolidayPreset } from "@hyunbinseo/holidays-kr";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import type { Todo } from "@/lib/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDue(due: string) {
  const d = new Date(due);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function WorkHistoryClient({ initialItems }: { initialItems: Todo[] }) {
  const [items, setItems] = useRealtimeTable<Todo>("todos", initialItems);
  const [viewOffset, setViewOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayLocal());
  const [holidays, setHolidays] = useState<Record<string, string[]>>({});

  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + viewOffset, 1);
  const vYear = viewDate.getFullYear();
  const vMonth = viewDate.getMonth();

  useEffect(() => {
    let cancelled = false;
    getHolidayPreset(String(vYear))
      .then((preset) => {
        if (!cancelled) setHolidays(preset as Record<string, string[]>);
      })
      .catch(() => {
        if (!cancelled) setHolidays({});
      });
    return () => {
      cancelled = true;
    };
  }, [vYear]);

  // 날짜별로 그날 할 일이 있는지, 아직 안 끝난 게 있는지 미리 묶어둡니다(달력 점 표시용).
  const byDate = useMemo(() => {
    const map = new Map<string, Todo[]>();
    for (const it of items) {
      const list = map.get(it.for_date) ?? [];
      list.push(it);
      map.set(it.for_date, list);
    }
    return map;
  }, [items]);

  const firstWeekday = new Date(vYear, vMonth, 1).getDay();
  const daysInMonth = new Date(vYear, vMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const selectedTodos = [...(byDate.get(selectedDate) ?? [])].sort((a, b) => {
    if (a.done !== b.done) return (a.done ? 1 : 0) - (b.done ? 1 : 0);
    if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
    return (a.created_at || "").localeCompare(b.created_at || "");
  });

  async function toggleDone(item: Todo) {
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, done: !it.done } : it)));
    const supabase = createClient();
    await supabase.from("todos").update({ done: !item.done }).eq("id", item.id);
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    const supabase = createClient();
    await supabase.from("todos").delete().eq("id", id);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => setViewOffset((v) => v - 1)}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100"
          >
            ‹ 이전달
          </button>
          <div className="text-sm font-bold text-slate-700">
            {vYear}년 {vMonth + 1}월
          </div>
          <button
            onClick={() => setViewOffset((v) => v + 1)}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100"
          >
            다음달 ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={"pb-1 font-semibold " + (i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-400")}>
              {w}
            </div>
          ))}
          {cells.map((day, idx) => {
            const col = idx % 7;
            if (!day) return <div key={idx} />;
            const dateKey = `${vYear}-${pad2(vMonth + 1)}-${pad2(day)}`;
            const dayTodos = byDate.get(dateKey) ?? [];
            const hasPending = dayTodos.some((t) => !t.done);
            const hasAny = dayTodos.length > 0;
            const holidayNames = holidays[dateKey];
            const isHoliday = !!holidayNames?.length;
            const isToday = dateKey === todayLocal();
            const isSelected = dateKey === selectedDate;
            return (
              <button
                key={idx}
                onClick={() => setSelectedDate(dateKey)}
                title={holidayNames?.join(" · ")}
                className={
                  "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg transition " +
                  (isSelected
                    ? "bg-blue-600 text-white"
                    : isToday
                    ? "bg-blue-50 text-blue-700"
                    : "hover:bg-slate-50")
                }
              >
                <span
                  className={
                    "text-xs " +
                    (isSelected
                      ? "font-bold text-white"
                      : isHoliday
                      ? "font-bold text-red-500"
                      : col === 0
                      ? "text-red-400"
                      : col === 6
                      ? "text-blue-400"
                      : "text-slate-700")
                  }
                >
                  {day}
                </span>
                {hasAny && (
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (isSelected ? "bg-white" : hasPending ? "bg-amber-500" : "bg-emerald-500")
                    }
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-bold text-slate-700">
          {selectedDate}
          {holidays[selectedDate]?.length ? ` · ${holidays[selectedDate].join(" · ")}` : ""}
        </div>
        {selectedTodos.length === 0 && (
          <p className="text-xs text-slate-300">이 날짜에 기록된 할 일이 없습니다.</p>
        )}
        <div className="flex flex-col gap-1.5">
          {selectedTodos.map((it) => (
            <div key={it.id} className="flex items-start gap-1.5 rounded-lg px-1 py-1 hover:bg-slate-50">
              <input type="checkbox" checked={it.done} onChange={() => toggleDone(it)} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className={"text-sm " + (it.done ? "text-slate-300 line-through" : "text-slate-700")}>
                  {it.text}
                </div>
                {it.due_at && (
                  <div className={"text-[10px] " + (it.done ? "text-slate-300" : "text-blue-500")}>
                    🕐 {formatDue(it.due_at)}
                  </div>
                )}
              </div>
              <button
                onClick={() => remove(it.id)}
                className="shrink-0 text-[10px] text-slate-300 hover:text-red-500"
                aria-label="삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
