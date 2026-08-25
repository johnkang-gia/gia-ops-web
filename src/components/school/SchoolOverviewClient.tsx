"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SchoolTabs from "./SchoolTabs";

export type GradeCount = { grade: string; count: number };
export type DeptCount = { dept: string; count: number };
export type SubjectRow = { name: string; teacher: string | null };
export type TermInfo = { label: string; start: string | null; end: string | null; dday: number | null };
export type SchoolKpi = {
  active: number;
  graduated: number;
  withdrawn: number;
  classes: number;
  noHomeroom: number;
  reportsThisWeek: number;
};
export type SchoolEvent = { date: string; name: string };
export type ClassRow = { grade: string; className: string; teacher: string | null; students: number; studentNames: string[] };

function useCountUp(target: number, ms = 650) {
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

function Kpi({ label, value, tone, sub, href }: { label: string; value: number; tone: string; sub?: string; href?: string }) {
  const n = useCountUp(value);
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => href && router.push(href)}
      className={"rounded-2xl border border-slate-200 bg-white p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md " + (href ? "cursor-pointer" : "cursor-default")}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-3xl font-extrabold tabular-nums" style={{ color: tone }}>{n}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </button>
  );
}

const barColors = ["#8b5cf6", "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

function fmtDate(d: string | null) {
  return d ? d.slice(2).replace(/-/g, ".") : "-";
}

export default function SchoolOverviewClient({
  kpi,
  grades,
  events,
  classRows,
  deptCounts,
  subjects,
  teacherCount,
  term,
  date,
}: {
  kpi: SchoolKpi;
  grades: GradeCount[];
  events: SchoolEvent[];
  classRows: ClassRow[];
  deptCounts: DeptCount[];
  subjects: SubjectRow[];
  teacherCount: number;
  term: TermInfo | null;
  date: string;
}) {
  const [openClass, setOpenClass] = useState<string | null>(null);
  const maxGrade = Math.max(1, ...grades.map((g) => g.count));
  const maxDept = Math.max(1, ...deptCounts.map((d) => d.count));
  const [barW, setBarW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setBarW(1), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <SchoolTabs />

      {/* 현재 학기 배너 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-purple-200 bg-purple-50/50 px-4 py-2.5">
        <span className="text-sm font-extrabold text-purple-800">📚 {term?.label ?? "학기 정보 없음"}</span>
        {term?.start && (
          <span className="text-xs text-purple-700">
            {fmtDate(term.start)} ~ {fmtDate(term.end)}
          </span>
        )}
        {term?.dday != null && (
          <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[11px] font-bold text-white">
            {term.dday > 0 ? `학기말 D-${term.dday}` : term.dday === 0 ? "오늘 학기말" : "학기 종료"}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">{date} 기준</span>
      </div>

      {/* KPI */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="재학생" value={kpi.active} tone="#7c3aed" sub="현재 재적" href="/students" />
        <Kpi label="반" value={kpi.classes} tone="#0f172a" href="/weekly-report/admin/classes" />
        <Kpi label="담임 미배정" value={kpi.noHomeroom} tone={kpi.noHomeroom ? "#dc2626" : "#0f172a"} sub="반 관리" href="/weekly-report/admin/classes" />
        <Kpi label="선생님" value={teacherCount} tone="#0d9488" sub="담임+과목" href="/staff" />
        <Kpi label="과목" value={subjects.length} tone="#2563eb" href="/weekly-report/admin/subjects" />
        <Kpi label="이번주 리포트" value={kpi.reportsThisWeek} tone="#16a34a" sub="위클리 작성" href="/weekly-report/students" />
      </div>

      {/* 부서별 재학생 */}
      <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <b className="text-sm">부서별 재학생</b>
          <span className="text-[11px] text-slate-400">재학 {kpi.active} · 졸업 {kpi.graduated} · 퇴학·전출 {kpi.withdrawn}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {deptCounts.length === 0 && <span className="text-xs text-slate-400">부서 정보가 없습니다.</span>}
          {deptCounts.map((d, i) => (
            <div key={d.dept} className="min-w-[120px] flex-1 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-600">{d.dept}</span>
                <span className="text-lg font-extrabold tabular-nums" style={{ color: barColors[i % barColors.length] }}>{d.count}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${barW ? (d.count / maxDept) * 100 : 0}%`, background: barColors[i % barColors.length] }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        {/* 반별 현황 (담임 + 학생 펼치기) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-sm">반별 현황 · 담임 · 학생</b>
            <span className="text-[11px] text-slate-400">반을 누르면 학생 명단 · 담임 미배정 {kpi.noHomeroom}</span>
          </div>
          <div className="max-h-[460px] overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-2 py-1.5 font-semibold">학년</th>
                  <th className="px-2 py-1.5 font-semibold">반</th>
                  <th className="px-2 py-1.5 font-semibold">담임</th>
                  <th className="px-2 py-1.5 text-center font-semibold">학생</th>
                </tr>
              </thead>
              <tbody>
                {classRows.length === 0 ? (
                  <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-400">등록된 반이 없습니다.</td></tr>
                ) : (
                  classRows.map((c, i) => {
                    const key = `${c.grade}-${c.className}-${i}`;
                    const open = openClass === key;
                    return (
                      <Fragment key={key}>
                        <tr
                          className="cursor-pointer border-b border-slate-100 hover:bg-purple-50/40"
                          onClick={() => setOpenClass(open ? null : key)}
                        >
                          <td className="px-2 py-1.5 text-xs text-slate-500">{c.grade || "-"}</td>
                          <td className="px-2 py-1.5 font-semibold text-slate-700">
                            <span className="mr-1 text-purple-300">{open ? "▾" : "▸"}</span>
                            {c.className || "-"}
                          </td>
                          <td className={"px-2 py-1.5 " + (c.teacher ? "text-slate-600" : "font-semibold text-red-500")}>{c.teacher ?? "미배정"}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums text-slate-700">{c.students}</td>
                        </tr>
                        {open && (
                          <tr className="border-b border-slate-100 bg-slate-50/60">
                            <td colSpan={4} className="px-3 py-2">
                              {c.studentNames.length === 0 ? (
                                <span className="text-xs text-slate-400">학생 정보가 없습니다.</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {c.studentNames.map((n, j) => (
                                    <span key={j} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 shadow-sm">{n}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 우측: 학년 분포 + 과목·선생님 + 학사일정 */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm">학년별 재학생</b>
              <span className="text-[11px] text-slate-400">총 {kpi.active}명</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {grades.length === 0 && <p className="text-xs text-slate-400">학년 데이터가 없습니다.</p>}
              {grades.map((d, i) => (
                <div key={d.grade} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs font-semibold text-slate-600">{d.grade}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div className="flex h-full items-center justify-end rounded pr-1.5 text-[10px] font-bold text-white transition-all duration-700" style={{ width: `${barW ? (d.count / maxGrade) * 100 : 0}%`, background: barColors[i % barColors.length], minWidth: 22 }}>{d.count}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <b className="text-sm">과목 · 선생님</b>
              <span className="text-[11px] text-slate-400">{subjects.length}과목</span>
            </div>
            {subjects.length === 0 ? (
              <p className="text-xs text-slate-400">등록된 과목이 없습니다.</p>
            ) : (
              <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {subjects.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-[12px]">
                    <span className="truncate font-semibold text-slate-700">{s.name}</span>
                    <span className="shrink-0 text-slate-500">{s.teacher ?? "-"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <b className="text-sm">📅 다가오는 학사일정</b>
              <button type="button" className="text-[11px] text-purple-600 hover:underline" onClick={() => (window.location.href = "/academic-calendar")}>전체 →</button>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-slate-400">예정된 일정이 없습니다.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {events.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 rounded-md bg-purple-50 px-1.5 py-0.5 text-center text-[11px] font-bold text-purple-700">{e.date.slice(5).replace("-", "/")}</span>
                    <span className="min-w-0 truncate text-slate-700">{e.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
