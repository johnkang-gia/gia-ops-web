"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SchoolTabs from "./SchoolTabs";

export type GradeCount = { grade: string; count: number };
export type SchoolKpi = {
  active: number;
  graduated: number;
  withdrawn: number;
  classes: number;
  noHomeroom: number;
  reportsThisWeek: number;
};
export type SchoolEvent = { date: string; name: string };
export type ClassRow = { grade: string; className: string; teacher: string | null; students: number };

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
      className={
        "rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md " +
        (href ? "cursor-pointer" : "cursor-default")
      }
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-3xl font-extrabold tabular-nums" style={{ color: tone }}>
        {n}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </button>
  );
}

// 학년별 분포 가로 막대(부드럽게 차오름).
function GradeBars({ data }: { data: GradeCount[] }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(1), 50);
    return () => clearTimeout(t);
  }, []);
  const max = Math.max(1, ...data.map((d) => d.count));
  const colors = ["#8b5cf6", "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];
  return (
    <div className="flex flex-col gap-2">
      {data.length === 0 && <p className="text-xs text-slate-400">학년 데이터가 없습니다.</p>}
      {data.map((d, i) => (
        <div key={d.grade} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs font-semibold text-slate-600">{d.grade}</span>
          <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div
              className="flex h-full items-center justify-end rounded-md pr-2 text-[10px] font-bold text-white transition-all duration-700"
              style={{ width: `${w ? (d.count / max) * 100 : 0}%`, background: colors[i % colors.length], minWidth: 24 }}
            >
              {d.count}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SchoolOverviewClient({
  kpi,
  grades,
  events,
  classRows,
  date,
}: {
  kpi: SchoolKpi;
  grades: GradeCount[];
  events: SchoolEvent[];
  classRows: ClassRow[];
  date: string;
}) {
  return (
    <div className="mx-auto max-w-6xl">
      <SchoolTabs />
      <div className="mb-3 text-right text-xs text-slate-400">{date} 기준</div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="재학생" value={kpi.active} tone="#7c3aed" sub="현재 재적" href="/students" />
        <Kpi label="졸업" value={kpi.graduated} tone="#0ea5e9" />
        <Kpi label="퇴학·전출" value={kpi.withdrawn} tone="#64748b" />
        <Kpi label="반" value={kpi.classes} tone="#0f172a" href="/weekly-report/admin/classes" />
        <Kpi label="담임 미배정" value={kpi.noHomeroom} tone={kpi.noHomeroom ? "#dc2626" : "#0f172a"} sub="반 관리 확인" href="/weekly-report/admin/classes" />
        <Kpi label="이번주 리포트" value={kpi.reportsThisWeek} tone="#0d9488" sub="위클리 작성" href="/weekly-report/students" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        {/* 반별 현황(요청: 숫자만 말고 정보를 자세히). 반·담임·학생수를 표로. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-sm">반별 현황</b>
            <span className="text-[11px] text-slate-400">{classRows.length}개 반 · 담임 미배정 {kpi.noHomeroom}</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
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
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-slate-400">
                      등록된 반이 없습니다.
                    </td>
                  </tr>
                ) : (
                  classRows.map((c, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-2 py-1.5 text-xs text-slate-500">{c.grade || "-"}</td>
                      <td className="px-2 py-1.5 font-semibold text-slate-700">{c.className || "-"}</td>
                      <td className={"px-2 py-1.5 text-sm " + (c.teacher ? "text-slate-600" : "font-semibold text-red-500")}>
                        {c.teacher ?? "미배정"}
                      </td>
                      <td className="px-2 py-1.5 text-center tabular-nums text-slate-700">{c.students}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 우측: 학년 분포 + 학사일정 */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm">학년별 재학생 분포</b>
              <span className="text-[11px] text-slate-400">총 {kpi.active}명</span>
            </div>
            <GradeBars data={grades} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <b className="text-sm">📅 다가오는 학사일정</b>
            <button type="button" className="text-[11px] text-purple-600 hover:underline" onClick={() => (window.location.href = "/academic-calendar")}>
              전체 →
            </button>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-slate-400">예정된 일정이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {events.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-14 shrink-0 rounded-md bg-purple-50 px-1.5 py-0.5 text-center text-[11px] font-bold text-purple-700">
                    {e.date.slice(5).replace("-", "/")}
                  </span>
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
