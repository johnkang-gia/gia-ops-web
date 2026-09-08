"use client";

import { useMemo, useState } from "react";
import type { Task } from "@/lib/types";
import { todayKst } from "@/lib/kst";

/**
 * 업무 달력 — 업무보드 한가운데.
 *
 * 여기 있던 채팅창은 거의 안 쓰였습니다. 사무실에 다 같이 앉아 있으니 말로 해버리니까요.
 * 그 자리에 들어갈 것은 **말로 대신할 수 없는 것**이어야 합니다 - 언제까지 무엇을 해야
 * 하는가가 그렇습니다. 「다음 주 어디까지 잡혀 있지」는 말로 물어보면 아무도 정확히 답하지
 * 못합니다.
 *
 * ── 왜 목록이 아니라 달력인가 ────────────────────────────────────────
 *
 * 흐름판(오른쪽)은 **무엇이 어디까지 됐나**를 봅니다. 달력은 **언제 몰려 있나**를 봅니다.
 * 같은 업무를 다르게 자르는 것이라 둘 다 필요합니다 - 흐름판만 보면 다음 주 수요일에 마감이
 * 다섯 개 겹친 것을 그날 아침에야 압니다.
 *
 * ── 무엇을 일부러 안 했는가 ──────────────────────────────────────────
 *
 * 주간·일간 보기를 넣지 않았습니다. 이 학교의 업무는 「이번 달 언제쯤」 단위로 잡히고,
 * 하루 안의 시각은 달력이 아니라 시간표가 봅니다. 보기 종류를 늘리면 그중 하나만 쓰이고
 * 나머지는 고를 때마다 망설이게 하는 짐이 됩니다.
 */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 한국 날짜 키(YYYY-MM-DD). 업무의 마감은 시각까지 있지만 달력은 날짜로만 봅니다. */
function dayKeyOf(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** 그 달의 달력에 그릴 날짜들. 앞뒤로 빈 칸을 채워 7의 배수로 맞춥니다. */
function monthGrid(year: number, month0: number): { key: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const startPad = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: { key: string; day: number; inMonth: boolean }[] = [];

  const prevDays = new Date(Date.UTC(year, month0, 0)).getUTCDate();
  for (let i = startPad - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month0 - 1, prevDays - i));
    cells.push({ key: d.toISOString().slice(0, 10), day: prevDays - i, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ key: new Date(Date.UTC(year, month0, d)).toISOString().slice(0, 10), day: d, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const n = cells.length - startPad - daysInMonth + 1;
    const d = new Date(Date.UTC(year, month0 + 1, n));
    cells.push({ key: d.toISOString().slice(0, 10), day: n, inMonth: false });
  }
  return cells;
}

const STATUS_DOT: Record<string, string> = {
  대기: "bg-slate-400",
  진행: "bg-blue-500",
  검토: "bg-amber-500",
  완료: "bg-emerald-500",
};

export default function WorkCalendar({
  tasks,
  onPickDate,
  onOpenTask,
  onMoveDue,
}: {
  tasks: Task[];
  /** 빈 날짜를 눌렀을 때. 그 날 마감으로 새 업무를 만듭니다. */
  onPickDate: (dayKey: string) => void;
  onOpenTask: (task: Task) => void;
  /** 업무를 다른 날로 끌어다 놓았을 때. 마감일만 바꿉니다. */
  onMoveDue: (task: Task, dayKey: string) => void;
}) {
  const today = todayKst();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m0: m - 1 };
  });
  const [dragId, setDragId] = useState<string | null>(null);

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m0), [cursor]);

  // 날짜별로 묶어둡니다. 칸마다 전체를 훑으면 업무가 늘수록 느려집니다.
  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = dayKeyOf(t.due_at);
      if (!k) continue;
      const list = m.get(k);
      if (list) list.push(t);
      else m.set(k, [t]);
    }
    return m;
  }, [tasks]);

  // 마감이 없는 업무. 달력에는 설 자리가 없지만 **없는 셈 치면 안 됩니다** - 마감을 안 정한
  // 것이지 안 하는 것이 아닙니다. 끌어다 날짜에 놓으면 그날로 정해집니다.
  const undated = useMemo(() => tasks.filter((t) => !t.due_at && t.status !== "완료"), [tasks]);

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m0 + delta, 1));
      return { y: d.getUTCFullYear(), m0: d.getUTCMonth() };
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── 달 옮기기 ─────────────────────────────────────────────── */}
      <div className="mb-1 flex shrink-0 items-center gap-2">
        <button onClick={() => move(-1)} className="rounded px-1.5 py-0.5 text-[13px] text-slate-500 hover:bg-slate-100">
          ‹
        </button>
        <b className="text-[13px] text-slate-800">
          {cursor.y}년 {cursor.m0 + 1}월
        </b>
        <button onClick={() => move(1)} className="rounded px-1.5 py-0.5 text-[13px] text-slate-500 hover:bg-slate-100">
          ›
        </button>
        <button
          onClick={() => {
            const [y, m] = today.split("-").map(Number);
            setCursor({ y, m0: m - 1 });
          }}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600"
        >
          오늘
        </button>
        <span className="ml-auto text-[10px] text-slate-400">날짜를 누르면 그 날 마감으로 등록됩니다</span>
      </div>

      <div className="grid shrink-0 grid-cols-7 gap-px text-center text-[10px] font-semibold text-slate-400">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : ""}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(auto-fit,minmax(0,1fr))] gap-px overflow-hidden rounded-lg bg-slate-200">
        {cells.map((c) => {
          const list = byDay.get(c.key) ?? [];
          const isToday = c.key === today;
          return (
            <div
              key={c.key}
              onClick={() => onPickDate(c.key)}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const t = tasks.find((x) => x.id === dragId);
                setDragId(null);
                if (t && dayKeyOf(t.due_at) !== c.key) onMoveDue(t, c.key);
              }}
              className={
                "flex min-h-0 cursor-pointer flex-col overflow-hidden p-1 transition-colors " +
                (c.inMonth ? "bg-white hover:bg-teal-50" : "bg-slate-50 text-slate-300 hover:bg-slate-100")
              }
            >
              <div className="flex shrink-0 items-center gap-1">
                <span
                  className={
                    "text-[10px] " +
                    (isToday
                      ? "flex h-4 w-4 items-center justify-center rounded-full bg-teal-600 font-bold text-white"
                      : c.inMonth
                        ? "text-slate-500"
                        : "text-slate-300")
                  }
                >
                  {c.day}
                </span>
                {list.length > 2 && <span className="text-[9px] text-slate-400">+{list.length - 2}</span>}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {list.slice(0, 2).map((t) => (
                  <button
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTask(t);
                    }}
                    title={t.title}
                    className="mt-0.5 flex w-full items-center gap-1 rounded bg-slate-100 px-1 py-0.5 text-left hover:bg-slate-200"
                  >
                    <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + (STATUS_DOT[t.status] ?? "bg-slate-400")} />
                    <span
                      className={
                        "min-w-0 flex-1 truncate text-[10px] " +
                        (t.status === "완료" ? "text-slate-400 line-through" : "text-slate-700")
                      }
                    >
                      {t.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 마감 없는 업무 ────────────────────────────────────────────
          달력에 설 자리가 없다고 없는 셈 치면, 마감을 안 정한 업무가 조용히 잊힙니다.
          끌어다 날짜에 놓으면 그날로 정해집니다. */}
      {undated.length > 0 && (
        <div className="mt-1 shrink-0">
          <p className="mb-0.5 text-[10px] font-semibold text-slate-400">
            마감 없음 {undated.length} · 끌어다 날짜에 놓으면 그날로 정해집니다
          </p>
          <div className="flex max-h-12 flex-wrap gap-1 overflow-y-auto">
            {undated.map((t) => (
              <button
                key={t.id}
                draggable
                onDragStart={() => setDragId(t.id)}
                onDragEnd={() => setDragId(null)}
                onClick={() => onOpenTask(t)}
                className="max-w-[140px] truncate rounded border border-dashed border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:border-teal-400"
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
