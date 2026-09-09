"use client";

import { useMemo, useState } from "react";
import type { DayReminder, Task, WorkTag } from "@/lib/types";
import { todayKst } from "@/lib/kst";
import { addDays, isSpan, layoutWeek, orderRange, type SpanTask } from "@/lib/taskSpan";

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
 * ── 여러 날짜리는 한 줄 막대로 ───────────────────────────────────────
 *
 * 「10일부터 14일까지 학기말 정리」를 14일 칸에 점 하나로 찍으면, 달력을 봐도 그 주가 통째로
 * 잡혀 있다는 것이 안 보입니다. 끌어서 만들고, 한 줄 막대로 그립니다. 어느 칸에서 시작해
 * 몇 칸을 차지하는지는 `@/lib/taskSpan` 이 계산합니다 - 주가 갈리는 자리에서만 어긋나는
 * 종류의 오류는 눈으로 못 찾아서, 시험할 수 있게 떼어놨습니다.
 *
 * ── 왜 색인가 ────────────────────────────────────────────────────────
 *
 * 칸에 뜨는 것이 전부 회색 상자면 무슨 일인지 열어봐야 압니다. 태그 색을 입히면 **훑는
 * 것만으로** 행사인지 정산인지 갈립니다.
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

/** 막대 한 줄의 높이(px). 칸 안에 몇 줄까지 들어가는지를 이 값으로 셉니다. */
const LANE_H = 15;
/** 막대에 내주는 자리. 이보다 많으면 「+n」으로 접습니다 - 칸이 막대로만 가득 차면 날짜가 안 보입니다. */
const MAX_LANES = 3;

export default function WorkCalendar({
  tasks,
  tags,
  reminders = [],
  onToggleReminder,
  onDeleteReminder,
  onPickDate,
  onPickRange,
  onOpenTask,
  onMoveDue,
  onRename,
}: {
  tasks: Task[];
  /** 색 태그 목록. 막대·점의 색이 여기서 나옵니다. */
  tags: WorkTag[];
  /**
   * 🔔 그날 챙길 것들. 업무와 **섞지 않고** 따로 그립니다 - 업무는 며칠씩 굴러가고
   * 알림은 그날로 끝이라, 한 줄에 섞이면 어느 쪽이 아직 남은 일인지 알 수 없습니다.
   */
  reminders?: DayReminder[];
  onToggleReminder?: (r: DayReminder) => void;
  onDeleteReminder?: (r: DayReminder) => void;
  /** 빈 날짜를 눌렀을 때. 그 날 마감으로 새 업무를 만듭니다. */
  onPickDate: (dayKey: string) => void;
  /** 여러 날을 끌어서 골랐을 때. 그 기간짜리 일정을 만듭니다. */
  onPickRange: (from: string, to: string) => void;
  onOpenTask: (task: Task) => void;
  /** 업무를 다른 날로 끌어다 놓았을 때. 마감일만 바꿉니다(기간짜리는 기간째 옮깁니다). */
  onMoveDue: (task: Task, dayKey: string) => void;
  /** 제목을 그 자리에서 고쳤을 때. */
  onRename: (task: Task, title: string) => void;
}) {
  const today = todayKst();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m0: m - 1 };
  });
  const [dragId, setDragId] = useState<string | null>(null);
  /** 끌어서 기간을 고르는 중. 누른 날과 지금 지나는 날. */
  const [picking, setPicking] = useState<{ from: string; to: string } | null>(null);
  /** 그 자리에서 제목을 고치는 중인 업무. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m0), [cursor]);

  /** 날짜 → 그날 알림. 칸을 그릴 때마다 전체를 훑지 않도록 한 번만 묶습니다. */
  const remindersByDay = useMemo(() => {
    const m = new Map<string, DayReminder[]>();
    for (const r of reminders) {
      const list = m.get(r.day) ?? [];
      list.push(r);
      m.set(r.day, list);
    }
    // 시각이 적힌 것이 먼저. 「3시 병원」은 시각이 곧 순서이고, 「오늘 중」은 언제든 됩니다.
    for (const list of m.values()) {
      list.sort((a, b) => (a.at_time ?? "99").localeCompare(b.at_time ?? "99"));
    }
    return m;
  }, [reminders]);

  /** 오늘 챙길 것. 달력 위에 따로 모읍니다 - 오늘 칸 안에 작게 넣으면 안 보고 지나갑니다. */
  const todayReminders = useMemo(
    () => (remindersByDay.get(today) ?? []).filter((r) => !r.done),
    [remindersByDay, today],
  );
  const colorOf = useMemo(() => new Map(tags.map((t) => [t.id, t.color])), [tags]);

  /** 달력에 그릴 재료. 끝날은 마감일의 한국 날짜입니다. */
  const spanOf = useMemo(() => {
    const m = new Map<string, SpanTask & { task: Task }>();
    for (const t of tasks) {
      const endOn = dayKeyOf(t.due_at);
      m.set(t.id, { id: t.id, title: t.title, startOn: t.start_on ?? null, endOn, task: t });
    }
    return m;
  }, [tasks]);

  /** 여러 날짜리(막대로 그릴 것)와 하루짜리(칸 안에 적을 것)를 갈라둡니다. */
  const { spans, singles } = useMemo(() => {
    const spans: (SpanTask & { task: Task })[] = [];
    const singles = new Map<string, Task[]>();
    for (const s of spanOf.values()) {
      if (!s.endOn) continue;
      if (isSpan(s)) {
        spans.push(s);
        continue;
      }
      const list = singles.get(s.endOn);
      if (list) list.push(s.task);
      else singles.set(s.endOn, [s.task]);
    }
    return { spans, singles };
  }, [spanOf]);

  // 마감이 없는 업무. 달력에는 설 자리가 없지만 **없는 셈 치면 안 됩니다** - 마감을 안 정한
  // 것이지 안 하는 것이 아닙니다. 끌어다 날짜에 놓으면 그날로 정해집니다.
  const undated = useMemo(() => tasks.filter((t) => !t.due_at && t.status !== "완료"), [tasks]);

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m0 + delta, 1));
      return { y: d.getUTCFullYear(), m0: d.getUTCMonth() };
    });

  /** 주 단위로 자릅니다. 막대는 주마다 따로 배치해야 줄이 안 엉킵니다. */
  const weeks = useMemo(() => {
    const out: { start: string; cells: typeof cells }[] = [];
    for (let i = 0; i < cells.length; i += 7) out.push({ start: cells[i].key, cells: cells.slice(i, i + 7) });
    return out;
  }, [cells]);

  /** 끌어서 고르는 중인 범위 안인가. 미리 칠해줘야 어디까지 잡혔는지 보입니다. */
  const inPicking = (key: string) => {
    if (!picking) return false;
    const { from, to } = orderRange(picking.from, picking.to);
    return key >= from && key <= to;
  };

  function finishPicking() {
    if (!picking) return;
    const { from, to } = orderRange(picking.from, picking.to);
    setPicking(null);
    if (from === to) onPickDate(from);
    else onPickRange(from, to);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" onMouseLeave={() => setPicking(null)}>
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
        {/* 색이 무엇을 뜻하는지 달력 안에 둡니다 - 범례가 다른 화면에 있으면 아무도 안 봅니다. */}
        <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
          {tags.slice(0, 6).map((t) => (
            <span key={t.id} className="flex shrink-0 items-center gap-0.5 text-[9px] text-slate-500">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
      </div>
      <p className="mb-1 shrink-0 text-[10px] text-slate-400">
        날짜를 누르면 <b>알림 · 업무 · 학사</b> 중에서 고릅니다 · <b>끌면 그 기간</b>짜리 업무 · 제목을 두 번 누르면 고칩니다
      </p>

      {/* ── 오늘 챙길 것 ─────────────────────────────────────────────
          오늘 칸 안에 작게 넣으면 안 보고 지나갑니다. 알림은 그날 지나면 못 되돌리는
          것들이라(약·병원·데리러 가기) 달력 위에 따로 모아 둡니다. */}
      {todayReminders.length > 0 && (
        <div className="mb-1 flex shrink-0 flex-wrap items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1">
          <span className="shrink-0 text-[10px] font-bold text-amber-700">🔔 오늘 챙길 것</span>
          {todayReminders.map((r) => (
            <span key={r.id} className="flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-amber-900">
              {r.at_time && <b className="tabular-nums">{r.at_time.slice(0, 5)}</b>}
              <button
                type="button"
                onClick={() => onToggleReminder?.(r)}
                title={r.note ? `${r.note}\n누르면 챙긴 것으로 표시합니다` : "누르면 챙긴 것으로 표시합니다"}
                className="font-semibold hover:line-through"
              >
                {r.title}
              </button>
              <button
                type="button"
                onClick={() => onDeleteReminder?.(r)}
                title="이 알림을 지웁니다"
                className="text-amber-400 hover:text-rose-500"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="grid shrink-0 grid-cols-7 gap-px text-center text-[10px] font-semibold text-slate-400">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : ""}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[repeat(auto-fit,minmax(0,1fr))] gap-px overflow-hidden rounded-lg bg-slate-200">
        {weeks.map((week) => {
          const bars = layoutWeek(spans, week.start);
          const shown = bars.filter((b) => b.lane < MAX_LANES);
          const hiddenCount = bars.length - shown.length;
          const laneCount = Math.min(MAX_LANES, bars.reduce((n, b) => Math.max(n, b.lane + 1), 0));
          return (
            <div key={week.start} className="relative grid min-h-0 grid-cols-7 gap-px">
              {week.cells.map((c) => {
                const list = singles.get(c.key) ?? [];
                const isToday = c.key === today;
                return (
                  <div
                    key={c.key}
                    onMouseDown={(e) => {
                      // 오른쪽 버튼·업무 위에서 시작한 것은 기간 고르기가 아닙니다.
                      if (e.button !== 0 || (e.target as HTMLElement).closest("[data-task]")) return;
                      setPicking({ from: c.key, to: c.key });
                    }}
                    onMouseEnter={() => picking && setPicking((p) => (p ? { ...p, to: c.key } : p))}
                    onMouseUp={finishPicking}
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
                      "flex min-h-0 cursor-pointer select-none flex-col overflow-hidden p-1 transition-colors " +
                      (inPicking(c.key)
                        ? "bg-teal-100"
                        : c.inMonth
                          ? "bg-white hover:bg-teal-50"
                          : "bg-slate-50 text-slate-300 hover:bg-slate-100")
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
                    {/* 막대가 앉을 만큼 자리를 비워둡니다 - 안 그러면 막대가 하루짜리 위에 겹칩니다. */}
                    <div style={{ height: laneCount * LANE_H }} className="shrink-0" />
                    {/* 🔔 그날 알림. **업무보다 위에** 둡니다 - 그날에만 뜻이 있으니 그날
                        가장 먼저 눈에 들어와야 합니다. 챙긴 것은 지우지 않고 흐리게 둡니다. */}
                    {(remindersByDay.get(c.key) ?? []).slice(0, 2).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        data-task
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleReminder?.(r);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        title={
                          `${r.at_time ? `${r.at_time.slice(0, 5)} ` : ""}${r.title}` +
                          (r.note ? `\n${r.note}` : "") +
                          `\n${r.done ? "챙김 — 누르면 되돌립니다" : "누르면 챙긴 것으로 표시합니다"}`
                        }
                        className={
                          "mt-0.5 flex w-full items-center gap-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-[9px] font-semibold transition " +
                          (r.done ? "bg-slate-100 text-slate-400 line-through" : "bg-amber-100 text-amber-900 hover:bg-amber-200")
                        }
                      >
                        <span className="shrink-0">{r.done ? "✔" : "🔔"}</span>
                        {r.at_time && <span className="shrink-0 tabular-nums">{r.at_time.slice(0, 5)}</span>}
                        <span className="truncate">{r.title}</span>
                      </button>
                    ))}
                    {(remindersByDay.get(c.key)?.length ?? 0) > 2 && (
                      <span className="text-[9px] text-amber-600">🔔 +{(remindersByDay.get(c.key)?.length ?? 0) - 2}</span>
                    )}
                    <div className="min-h-0 flex-1 overflow-hidden">
                      {list.slice(0, 2).map((t) => {
                        const color = t.tag_id ? colorOf.get(t.tag_id) : null;
                        return (
                          <div
                            key={t.id}
                            data-task
                            draggable={editing?.id !== t.id}
                            onDragStart={() => setDragId(t.id)}
                            onDragEnd={() => setDragId(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editing?.id !== t.id) onOpenTask(t);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setEditing({ id: t.id, text: t.title });
                            }}
                            title={`${t.title} — 두 번 누르면 제목을 고칩니다`}
                            className="mt-0.5 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:brightness-95"
                            style={{ backgroundColor: color ? `${color}22` : undefined }}
                          >
                            <span
                              className={"h-1.5 w-1.5 shrink-0 rounded-full " + (color ? "" : (STATUS_DOT[t.status] ?? "bg-slate-400"))}
                              style={color ? { backgroundColor: color } : undefined}
                            />
                            {editing?.id === t.id ? (
                              <TitleEditor
                                value={editing.text}
                                onChange={(v) => setEditing({ id: t.id, text: v })}
                                onDone={(v) => {
                                  setEditing(null);
                                  if (v.trim() && v !== t.title) onRename(t, v.trim());
                                }}
                              />
                            ) : (
                              <span
                                className={
                                  "min-w-0 flex-1 truncate text-[10px] " +
                                  (t.status === "완료" ? "text-slate-400 line-through" : "text-slate-700")
                                }
                              >
                                {t.title}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* ── 여러 날짜리 막대 ────────────────────────────────────
                  칸 위에 겹쳐 그립니다. 칸 안에 넣으면 날마다 잘려서, 이어진 하나로 안 보입니다. */}
              {shown.map((b) => {
                const t = (b.task as SpanTask & { task: Task }).task;
                const color = (t.tag_id ? colorOf.get(t.tag_id) : null) ?? "#64748b";
                return (
                  <div
                    key={`${t.id}-${week.start}`}
                    data-task
                    onClick={(e) => {
                      e.stopPropagation();
                      if (editing?.id !== t.id) onOpenTask(t);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditing({ id: t.id, text: t.title });
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    title={`${t.title} · ${t.start_on} ~ ${dayKeyOf(t.due_at)} — 두 번 누르면 제목을 고칩니다`}
                    className={
                      "absolute z-10 flex cursor-pointer items-center overflow-hidden px-1.5 text-[10px] font-semibold text-white " +
                      (b.continuesLeft ? "" : "rounded-l ") +
                      (b.continuesRight ? "" : "rounded-r")
                    }
                    style={{
                      backgroundColor: color,
                      left: `calc(${(b.col / 7) * 100}% + 1px)`,
                      width: `calc(${(b.span / 7) * 100}% - 2px)`,
                      // 날짜 숫자 아래(18px)부터 줄마다 한 칸씩.
                      top: 18 + b.lane * LANE_H,
                      height: LANE_H - 2,
                      opacity: t.status === "완료" ? 0.45 : 1,
                    }}
                  >
                    {/* 이어져 온 막대에는 화살표를 답니다 - 없으면 그 주에서 시작한 일로 읽힙니다. */}
                    {b.continuesLeft && <span className="mr-0.5 shrink-0 opacity-70">‹</span>}
                    {editing?.id === t.id ? (
                      <TitleEditor
                        dark
                        value={editing.text}
                        onChange={(v) => setEditing({ id: t.id, text: v })}
                        onDone={(v) => {
                          setEditing(null);
                          if (v.trim() && v !== t.title) onRename(t, v.trim());
                        }}
                      />
                    ) : (
                      <span className={"min-w-0 flex-1 truncate " + (t.status === "완료" ? "line-through" : "")}>{t.title}</span>
                    )}
                    {b.continuesRight && <span className="ml-0.5 shrink-0 opacity-70">›</span>}
                  </div>
                );
              })}
              {hiddenCount > 0 && (
                <span className="pointer-events-none absolute right-1 z-10 text-[9px] font-bold text-slate-400" style={{ top: 18 + MAX_LANES * LANE_H }}>
                  +{hiddenCount}
                </span>
              )}
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

/**
 * 그 자리에서 제목 고치기.
 *
 * 상세 창을 열어야만 고칠 수 있으면, 오타 한 글자를 고치려고 창을 열고 닫습니다. 그러면
 * 대개 안 고치고 넘어갑니다 - 그 오타가 몇 달 남습니다.
 *
 * 엔터로 저장, Esc 로 취소. **밖을 눌러도 저장합니다** - 다 고쳐놓고 딴 데를 눌렀을 때
 * 방금 친 것이 사라지면, 그 뒤로는 무서워서 못 씁니다.
 */
function TitleEditor({
  value,
  onChange,
  onDone,
  dark,
}: {
  value: string;
  onChange: (v: string) => void;
  onDone: (v: string) => void;
  dark?: boolean;
}) {
  return (
    <input
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
        // 취소는 «고치기 전 값»으로 되돌리는 것이 아니라 그냥 닫습니다 - 되돌린 값을 다시
        // 저장하면 그게 더 헷갈립니다.
        if (e.key === "Escape") onDone("");
      }}
      className={
        "min-w-0 flex-1 rounded bg-transparent px-0.5 text-[10px] outline-none ring-1 " +
        (dark ? "text-white ring-white/60 placeholder:text-white/60" : "text-slate-800 ring-teal-400")
      }
    />
  );
}
