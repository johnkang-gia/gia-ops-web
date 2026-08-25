"use client";

import { useMemo, useState } from "react";
import type { Task, TaskStatus } from "@/lib/types";
import { STATUS_LABEL, STATUS_COLOR } from "./statusConfig";
import GuideButton from "@/components/common/GuideButton";
import WorkTabs from "./WorkTabs";
import {
  type ReportPeriodType,
  PERIOD_TYPE_LABEL,
  getReportRange,
  shiftAnchor,
  toDateStr,
} from "@/lib/reportPeriod";

const GUIDE_SECTIONS = [
  {
    title: "🗂 업무 보고서란?",
    lines: [
      "구두로만 지시/보고되던 업무를 일간·주간·월간 단위 문서로 남깁니다. 그 기간에 완료된 업무(언제·누가·무엇을)와, 아직 진행 중이던 업무 현황을 한 장으로 모아 보여줍니다.",
      "상단에서 일간/주간/월간을 고르고 ◀ ▶ 로 원하는 기간으로 이동한 뒤, \"🖨 인쇄/PDF\" 버튼을 누르면 새 탭에 인쇄용 문서가 열립니다. 그대로 인쇄하거나 PDF로 저장해 관리자에게 바로 전달할 수 있습니다.",
    ],
  },
];

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${toDateStr(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function WorkReportClient({
  tasks,
  nameByEmail,
}: {
  tasks: Task[];
  nameByEmail: Record<string, string>;
}) {
  const [periodType, setPeriodType] = useState<ReportPeriodType>("day");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [department, setDepartment] = useState<string>("전체");

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.department) set.add(t.department);
    return ["전체", ...Array.from(set).sort()];
  }, [tasks]);

  const range = useMemo(() => getReportRange(periodType, anchor), [periodType, anchor]);

  const scoped = useMemo(
    () => (department === "전체" ? tasks : tasks.filter((t) => t.department === department)),
    [tasks, department]
  );

  const completed = useMemo(
    () =>
      scoped
        .filter((t) => t.completed_at && t.completed_at.slice(0, 10) >= range.start && t.completed_at.slice(0, 10) <= range.end)
        .sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? "")),
    [scoped, range]
  );

  const active = useMemo(
    () =>
      scoped
        .filter((t) => t.status !== "완료" && t.created_at.slice(0, 10) <= range.end)
        .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999")),
    [scoped, range]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = { 예정: 0, 진행중: 0, 보류: 0, 완료: 0 };
    for (const t of active) counts[t.status] += 1;
    counts.완료 = completed.length;
    return counts;
  }, [active, completed]);

  const nameOf = (email: string) => nameByEmail[email] ?? email;

  // 보고서 시각화(요청 ③): 이 기간 완료 업무를 담당자별·부서별·일자별 막대로 보여줍니다.
  // 숫자 나열보다 "누가·어느 부서가·언제 일이 몰렸는지"가 한눈에 잡히도록.
  const viz = useMemo(() => {
    const byPerson = new Map<string, number>();
    const byDept = new Map<string, number>();
    const byDay = new Map<string, number>();
    for (const t of completed) {
      for (const e of t.assignee_emails?.length ? t.assignee_emails : [t.owner_email]) {
        byPerson.set(e, (byPerson.get(e) ?? 0) + 1);
      }
      byDept.set(t.department ?? "미지정", (byDept.get(t.department ?? "미지정") ?? 0) + 1);
      const d = (t.completed_at ?? "").slice(5, 10).replace("-", "/");
      if (d) byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return {
      person: top(byPerson, 8),
      dept: top(byDept, 8),
      day: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [completed]);

  const VIZ_COLORS = ["#2563eb", "#0ea5e9", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];

  function BarList({ title, data, labelFn }: { title: string; data: [string, number][]; labelFn?: (k: string) => string }) {
    const max = Math.max(1, ...data.map(([, v]) => v));
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-xs font-bold text-slate-600">{title}</h3>
        {data.length === 0 ? (
          <p className="text-[11px] text-slate-300">데이터 없음</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.map(([k, v], i) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-[11px] font-semibold text-slate-600">{labelFn ? labelFn(k) : k}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className="flex h-full items-center justify-end rounded pr-1.5 text-[10px] font-bold text-white transition-all duration-700"
                    style={{ width: `${(v / max) * 100}%`, background: VIZ_COLORS[i % VIZ_COLORS.length], minWidth: 20 }}
                  >
                    {v}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const pdfHref = `/api/work/report/pdf?type=${periodType}&date=${toDateStr(anchor)}&department=${encodeURIComponent(department)}`;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="shrink-0"><WorkTabs /></div>
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">🗂 업무 보고서</h1>
          <p className="mt-0.5 text-xs text-slate-500">일간·주간·월간 단위로 업무 처리 현황을 문서로 정리합니다.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={pdfHref}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            🖨 인쇄/PDF
          </a>
          <GuideButton title="업무 보고서 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(["day", "week", "month"] as ReportPeriodType[]).map((t) => (
            <button
              key={t}
              onClick={() => setPeriodType(t)}
              className={
                "rounded-md px-3 py-1 text-xs font-semibold transition " +
                (periodType === t ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-50")
              }
            >
              {PERIOD_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAnchor((a) => shiftAnchor(periodType, a, -1))}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            ◀
          </button>
          <span className="min-w-[10rem] rounded-lg bg-slate-100 px-2.5 py-1 text-center text-xs font-semibold text-slate-700">
            {range.label}
          </span>
          <button
            onClick={() => setAnchor((a) => shiftAnchor(periodType, a, 1))}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            ▶
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            오늘
          </button>
        </div>
        {departments.length > 2 && (
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
          >
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["완료", "진행중", "예정", "보류"] as TaskStatus[]).map((s) => (
            <div key={s} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className="text-lg font-bold" style={{ color: STATUS_COLOR[s] }}>
                {statusCounts[s]}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">{STATUS_LABEL[s]}</div>
            </div>
          ))}
        </div>

        {/* 시각화(요청 ③): 담당자별·부서별·일자별 완료 막대 */}
        {completed.length > 0 && (
          <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <BarList title="👤 담당자별 완료" data={viz.person} labelFn={nameOf} />
            <BarList title="🏷️ 부서별 완료" data={viz.dept} />
            <BarList title="📅 일자별 완료" data={viz.day} />
          </div>
        )}

        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">✅ 이 기간에 완료된 업무 ({completed.length}건)</h2>
          {completed.length === 0 ? (
            <p className="text-xs text-slate-400">이 기간에 완료된 업무가 없습니다.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {completed.map((t) => (
                <div key={t.id} className="py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-400">{formatDateTime(t.completed_at)}</span>
                    <span className="font-semibold text-slate-700">{t.title}</span>
                    {t.priority === "긴급" && (
                      <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">긴급</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    담당 {t.assignee_emails.length ? t.assignee_emails.map(nameOf).join(", ") : nameOf(t.owner_email)} · 등록 {nameOf(t.owner_email)}
                    {t.department ? ` · ${t.department}` : ""}
                  </div>
                  {t.description && <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">{t.description}</p>}
                  {t.resolution_note && (
                    <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 px-2 py-1 text-[11px] leading-relaxed text-slate-600">
                      <span className="font-semibold text-slate-500">처리결과: </span>
                      {t.resolution_note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">📌 이 기간 진행 중이던 업무 현황 ({active.length}건)</h2>
          {active.length === 0 ? (
            <p className="text-xs text-slate-400">이 기간에 진행 중이던 업무가 없습니다.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {active.map((t) => (
                <div key={t.id} className="flex items-center gap-2 py-1.5 text-xs">
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    style={{ backgroundColor: STATUS_COLOR[t.status] }}
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className="flex-1 truncate font-medium text-slate-700">{t.title}</span>
                  <span className="shrink-0 text-slate-400">{t.assignee_emails.length ? t.assignee_emails.map(nameOf).join(", ") : nameOf(t.owner_email)}</span>
                  {t.due_at && <span className="shrink-0 text-slate-400">마감 {t.due_at.slice(0, 10)}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
