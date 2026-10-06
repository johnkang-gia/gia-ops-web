"use client";

import { useEffect, useMemo, useState } from "react";
import { whereNow, placeOfCell, type PeriodRow, type TimetableRow } from "@/lib/whereNow";
import { gradeSortKey } from "@/lib/department";
import { kstTime, kstWeekday } from "@/lib/kst";

/**
 * **오늘 시간표** — 업무보드에서 여는 창.
 *
 * 학부모 전화를 받거나 아이를 데리러 가야 할 때 필요한 것은 「지금 그 반이 어디 있나」입니다.
 * 반 이름만 알고 교실에 갔는데 체육 시간이면 체육관까지 한 번 더 걷게 됩니다. 시간표 화면은
 * 학교 메뉴 깊숙이 있어서, 업무 중에 열어 볼 자리가 없었습니다.
 *
 *   · 「지금」 탭 — 모든 반이 지금 몇 교시·무슨 수업·어디인지. 제 교실이 아니면 눈에 띄게.
 *   · 학년 탭 — 반을 고르면 그 반의 한 주 시간표. 칸마다 장소까지.
 *
 * 장소 판정은 학생 검색의 「지금 위치」와 같은 함수(`whereNow` · `placeOfCell`)입니다.
 */

type Cls = {
  id: string;
  grade: string | null;
  className: string | null;
  room: string | null;
  department: string | null;
  teacher: string | null;
  subTeacher: string | null;
};
type Cell = TimetableRow & { teacher_name: string | null };

const DAYS = ["월", "화", "수", "목", "금"];

function gradeLabel(g: string | null): string {
  const t = (g ?? "").trim();
  if (!t) return "학년 없음";
  return /^\d+$/.test(t) ? `${t}학년` : t;
}
const hm = (t: string) => t.slice(0, 5);

export default function TodayTimetableBadge() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ classes: Cls[]; periods: PeriodRow[]; timetable: Cell[]; warning: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("now");
  const [pickedClass, setPickedClass] = useState<string | null>(null);
  // 창을 열어 둔 채 교시가 바뀌면 따라가야 합니다. 30초마다 다시 그립니다(자료는 다시 안 읽음).
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open || data) return;
    void (async () => {
      const res = await fetch("/api/work/timetable", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        classes?: Cls[];
        periods?: PeriodRow[];
        timetable?: Cell[];
        warning?: string | null;
        error?: string;
      };
      if (!res.ok) return setError(body.error ?? `시간표를 읽지 못했습니다(${res.status})`);
      setData({ classes: body.classes ?? [], periods: body.periods ?? [], timetable: body.timetable ?? [], warning: body.warning ?? null });
    })();
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const grades = useMemo(() => {
    const m = new Map<string, Cls[]>();
    for (const c of data?.classes ?? []) {
      const k = gradeLabel(c.grade);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()]
      .sort((a, b) => gradeSortKey(a[1][0]?.grade) - gradeSortKey(b[1][0]?.grade) || a[0].localeCompare(b[0]))
      .map(([label, list]) => ({ label, list: list.sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "")) }));
  }, [data]);

  const nowTime = useMemo(() => kstTime(new Date()), [tick, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekday = kstWeekday();

  /** 이 반 부서의 교시표. 부서를 모르면 전부. */
  const periodsOf = (c: Cls) => {
    const all = data?.periods ?? [];
    const mine = all.filter((p) => p.department === c.department);
    return (mine.length > 0 ? mine : all).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
  };
  const nowPeriodOf = (c: Cls) => periodsOf(c).find((p) => p.start_time.slice(0, 8) <= nowTime && nowTime < p.end_time.slice(0, 8)) ?? null;

  const picked = data?.classes.find((c) => c.id === pickedClass) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="모든 반의 지금 수업·위치, 반별 한 주 시간표·담임·교실"
        className="shrink-0 whitespace-nowrap rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-800 transition hover:bg-indigo-100"
      >
        🗓️ 오늘 시간표
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3" onClick={() => setOpen(false)}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <b className="text-sm text-slate-800">🗓️ 오늘 시간표</b>
              <span className="text-[12px] text-slate-500">
                {weekday >= 1 && weekday <= 5 ? `${DAYS[weekday - 1]}요일` : "주말"} · 지금 {hm(nowTime)}
              </span>
              <button onClick={() => setOpen(false)} className="ml-auto px-1 text-lg font-bold text-slate-400 hover:text-slate-700" title="닫기 (Esc)">
                ✕
              </button>
            </div>

            {/* 탭: 지금 + 학년들 */}
            <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
              {[{ key: "now", label: "📍 지금 전체" }, ...grades.map((g) => ({ key: g.label, label: g.label }))].map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                    if (t.key !== "now") setPickedClass(grades.find((g) => g.label === t.key)?.list[0]?.id ?? null);
                  }}
                  className={"rounded-full px-3 py-1 text-[12px] font-bold " + (tab === t.key ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">{error}</p>}
              {!data && !error && <p className="p-6 text-center text-sm text-slate-400">읽는 중…</p>}
              {data?.warning && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">{data.warning}</p>}

              {/* ── 지금 전체 ───────────────────────────────────────────── */}
              {data && tab === "now" && (
                <div className="space-y-3">
                  {grades.map((g) => (
                    <div key={g.label}>
                      <div className="mb-1 text-[12px] font-black text-slate-600">{g.label}</div>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                        {g.list.map((c) => {
                          const w = whereNow({ classId: c.id, department: c.department, classRoom: c.room, periods: data.periods, timetable: data.timetable });
                          // 제 교실이 아닌 곳에 있으면 눈에 띄게 - 찾으러 가는 사람이 헛걸음하는 자리입니다.
                          const away = w.known && (c.room ?? "").trim() !== w.place;
                          return (
                            <button
                              key={c.id}
                              onClick={() => {
                                setTab(g.label);
                                setPickedClass(c.id);
                              }}
                              className={
                                "rounded-lg border px-2.5 py-1.5 text-left hover:shadow " +
                                (away ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white")
                              }
                              title="눌러서 이 반의 한 주 시간표 보기"
                            >
                              <div className="flex items-baseline gap-1.5">
                                <b className="text-[13px] text-slate-800">{c.className ?? "반 이름 없음"}</b>
                                <span className="truncate text-[11px] text-slate-500">
                                  {c.teacher ?? "담임 미지정"}
                                  {c.subTeacher ? ` · ${c.subTeacher}` : ""}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500">🏫 교실 {c.room ?? "미지정"}</div>
                              {w.known ? (
                                <div className={"mt-0.5 text-[12px] font-bold " + (away ? "text-amber-800" : "text-emerald-700")}>
                                  📍 {w.place}
                                  <span className="ml-1 font-normal text-slate-600">
                                    {w.periodLabel} · {w.subject}
                                  </span>
                                </div>
                              ) : (
                                <div className="mt-0.5 text-[11px] text-slate-400" title={w.why}>
                                  📍 {w.short}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {grades.length === 0 && <p className="text-center text-sm text-slate-400">등록된 반이 없습니다.</p>}
                </div>
              )}

              {/* ── 학년 탭: 반 고르기 + 한 주 시간표 ─────────────────────── */}
              {data && tab !== "now" && (
                <div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {(grades.find((g) => g.label === tab)?.list ?? []).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setPickedClass(c.id)}
                        className={"rounded-lg px-2.5 py-1 text-[12px] font-bold " + (pickedClass === c.id ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                      >
                        {c.className ?? "?"}
                      </button>
                    ))}
                  </div>
                  {picked && (
                    <WeekGrid
                      cls={picked}
                      periods={periodsOf(picked)}
                      cells={data.timetable.filter((t) => t.class_id === picked.id)}
                      nowPeriodId={weekday >= 1 && weekday <= 5 ? nowPeriodOf(picked)?.id ?? null : null}
                      weekday={weekday}
                      now={whereNow({ classId: picked.id, department: picked.department, classRoom: picked.room, periods: data.periods, timetable: data.timetable })}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WeekGrid({
  cls,
  periods,
  cells,
  nowPeriodId,
  weekday,
  now,
}: {
  cls: Cls;
  periods: PeriodRow[];
  cells: Cell[];
  nowPeriodId: string | null;
  weekday: number;
  now: ReturnType<typeof whereNow>;
}) {
  const home = (cls.room ?? "").trim();
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[12px]">
        <b className="text-[14px] text-slate-800">{cls.className}</b>
        <span>👩‍🏫 담임 <b>{cls.teacher ?? "미지정"}</b>{cls.subTeacher ? ` · 부담임 ${cls.subTeacher}` : ""}</span>
        <span>🏫 정규 교실 <b>{cls.room ?? "미지정"}</b></span>
        <span className={now.known && now.place !== home ? "font-bold text-amber-800" : "text-emerald-700"}>
          📍 지금 {now.known ? `${now.place} (${now.periodLabel} ${now.subject})` : now.short}
        </span>
      </div>
      {cells.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[12px] text-slate-400">이 반은 시간표가 입력되지 않았습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-slate-100 text-[11px] text-slate-500">
                <th className="w-24 border border-slate-200 px-2 py-1 text-left">교시</th>
                {DAYS.map((d, i) => (
                  <th key={d} className={"border border-slate-200 px-2 py-1 " + (i + 1 === weekday ? "bg-indigo-100 text-indigo-800" : "")}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td className="border border-slate-200 px-2 py-1 align-top">
                    <div className="font-bold text-slate-700">{p.label || `${p.period_no}교시`}</div>
                    <div className="text-[10px] text-slate-400">
                      {hm(p.start_time)}~{hm(p.end_time)}
                    </div>
                  </td>
                  {DAYS.map((_, i) => {
                    const cell = cells.find((t) => t.weekday === i + 1 && t.period_id === p.id);
                    const isNow = i + 1 === weekday && p.id === nowPeriodId;
                    const place = cell ? placeOfCell(cell, cls.room) : null;
                    const away = !!place && place.place !== home;
                    return (
                      <td
                        key={i}
                        className={
                          "border border-slate-200 px-2 py-1 align-top " +
                          (isNow ? "bg-indigo-50 ring-2 ring-inset ring-indigo-500 " : i + 1 === weekday ? "bg-indigo-50/40 " : "")
                        }
                      >
                        {cell ? (
                          <>
                            <div className="font-semibold text-slate-800">{cell.subject_name}</div>
                            <div className={"text-[10px] " + (away ? "font-bold text-amber-700" : "text-slate-400")}>
                              📍 {place?.place ?? "장소 미지정"}
                              {cell.teacher_name ? <span className="font-normal text-slate-400"> · {cell.teacher_name}</span> : null}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-400">
            주황색 장소는 정규 교실이 아닌 곳입니다. 파란 테두리가 지금 수업입니다. 장소는 시간표에 적힌 곳 → 과목(체육·컴퓨터 등) → 반 교실 순으로 정합니다.
          </p>
        </div>
      )}
    </div>
  );
}
