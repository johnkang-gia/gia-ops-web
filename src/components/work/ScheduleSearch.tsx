"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchSchedules, type SearchableAcademic, type SearchableTask } from "@/lib/scheduleSearch";

/**
 * **등록해 둔 일정 찾기** — 달력 머리줄의 검색칸.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 일정이 쌓이면 「그거 언제였지」를 달마다 화살표로 넘겨보며 찾습니다. 석 달 뒤 것은 세 번,
 * 지난 것은 몇 번 눌러야 하는지도 모릅니다. 그러면 대개 찾다 말고 옆 사람에게 물어봅니다.
 *
 * ── 왜 업무와 학사를 함께 찾나 ──────────────────────────────────────────────
 *
 * 「크리스마스 콘서트」가 업무인지 학사일정인지는 **등록한 사람만 압니다.** 갈래를 골라
 * 찾게 하면 반은 빈 목록을 보고 「없네」 하고 돌아섭니다. 한 칸에서 둘 다 찾고, 찾은 뒤에
 * 갈래를 알려줍니다.
 *
 * 누르면 그 달로 옮깁니다. 여기서 고치지는 않습니다 - 찾는 일과 고치는 일은 다른 일이고,
 * 찾자마자 고치는 창이 뜨면 「어디 있는지만 보려던」 사람이 놀랍니다.
 */
export default function ScheduleSearch({
  tasks,
  academics,
  today,
  onJump,
}: {
  tasks: SearchableTask[];
  academics: SearchableAcademic[];
  today: string;
  /** 고른 일정의 날짜. 달력이 그 달로 넘어갑니다. */
  onJump: (date: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => searchSchedules(q, tasks, academics, today), [q, tasks, academics, today]);

  // 바깥을 누르면 닫습니다. 목록이 떠 있는 채로 달력을 만지면 무엇을 누르는지 헷갈립니다.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={boxRef} className="relative shrink-0">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          // 한 건뿐이면 엔터로 바로 갑니다 - 대개 찾는 것은 하나입니다.
          if (e.key === "Enter" && hits.length > 0 && hits[0].date) {
            onJump(hits[0].date);
            setOpen(false);
          }
        }}
        placeholder="🔍 일정 찾기"
        className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-[11px] focus:w-44 focus:outline-none focus:ring-1 focus:ring-teal-400"
      />

      {open && q.trim().length > 0 && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {hits.length === 0 ? (
            // **「없다」와 「못 찾았다」를 가릅니다.** 지난 학기 것까지 다 훑었다는 말을
            // 함께 적어야, 사람이 다른 데를 더 찾아볼지 판단합니다.
            <p className="px-2 py-3 text-center text-[11px] text-slate-400">
              업무·학사일정에서 「{q.trim()}」을(를) 못 찾았습니다.
            </p>
          ) : (
            hits.map((h) => (
              <button
                key={`${h.kind}:${h.id}`}
                type="button"
                onClick={() => {
                  if (h.date) onJump(h.date);
                  setOpen(false);
                }}
                disabled={!h.date}
                className="flex w-full items-baseline gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50"
              >
                <span
                  className={
                    "shrink-0 rounded px-1 text-[10px] font-bold " +
                    (h.kind === "학사" ? "bg-fuchsia-100 text-fuchsia-700" : "bg-teal-100 text-teal-700")
                  }
                >
                  {h.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{h.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{h.when}</span>
                {/* 며칠 남았는지가 「언제인가」보다 먼저 읽힙니다 - 오늘 할 일인지 아닌지가
                    그 한 글자로 갈립니다. */}
                {h.dayDiff !== null && (
                  <span
                    className={
                      "shrink-0 text-[10px] font-bold " +
                      (h.dayDiff === 0 ? "text-rose-600" : h.dayDiff > 0 ? "text-slate-500" : "text-slate-300")
                    }
                  >
                    {h.dayDiff === 0 ? "오늘" : h.dayDiff > 0 ? `D-${h.dayDiff}` : "지남"}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
