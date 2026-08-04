"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Task, TaskComment, Term, TeamMember, Department } from "@/lib/types";
import { nameFor } from "@/lib/teamName";

function fmtDateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type DateGroup = { dateKey: string; label: string; tasks: Task[] };
type TermGroup = { key: string; label: string; dates: DateGroup[] };
type YearGroup = { year: string; termGroups: TermGroup[] };

export default function TaskHistoryClient({
  tasks,
  terms,
  team,
  departments,
  currentUserEmail,
}: {
  tasks: Task[];
  terms: Term[];
  team: TeamMember[];
  departments: Department[];
  currentUserEmail: string;
}) {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [collapsedKeys, setCollapsedKeys] = useState<Record<string, boolean>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const termById = useMemo(() => new Map(terms.map((t) => [t.id, t])), [terms]);
  const deptColorMap = useMemo(() => new Map(departments.map((d) => [d.name, d.color])), [departments]);

  const filtered = tasks.filter((t) => {
    if (scope === "mine" && t.owner_email !== currentUserEmail && !t.assignee_emails.includes(currentUserEmail)) return false;
    if (deptFilter !== "all" && t.department !== deptFilter) return false;
    return true;
  });

  // 연도 > 학기 > 날짜 순으로 묶습니다. term_id가 있으면 그 학기의 연도/학기명을 쓰고,
  // 없으면(학기 기간 밖에 완료된 경우) 완료 시각의 달력 연도를 대신 씁니다.
  const years: YearGroup[] = useMemo(() => {
    const yearMap = new Map<string, Map<string, Map<string, Task[]>>>();
    for (const t of filtered) {
      const basis = t.completed_at ?? t.archived_at ?? t.updated_at;
      const term = t.term_id ? termById.get(t.term_id) : undefined;
      const year = term?.year ?? String(new Date(basis).getFullYear());
      const termKey = term?.term_type ?? "학기 미지정";
      const dateKey = fmtDateKey(basis);

      if (!yearMap.has(year)) yearMap.set(year, new Map());
      const termMap = yearMap.get(year)!;
      if (!termMap.has(termKey)) termMap.set(termKey, new Map());
      const dateMap = termMap.get(termKey)!;
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
      dateMap.get(dateKey)!.push(t);
    }

    return [...yearMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, termMap]) => ({
        year,
        termGroups: [...termMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, dateMap]) => ({
            key,
            label: key,
            dates: [...dateMap.entries()]
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([dateKey, dateTasks]) => ({
                dateKey,
                label: fmtDateLabel(dateTasks[0].completed_at ?? dateTasks[0].archived_at ?? dateTasks[0].updated_at),
                tasks: dateTasks.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
              })),
          })),
      }));
  }, [filtered, termById]);

  function toggle(key: string) {
    setCollapsedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function toggleExpand(taskId: string) {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(taskId);
    setComments([]);
    setLoadingComments(true);
    const supabase = createClient();
    const { data } = await supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true });
    setComments((data as TaskComment[] | null) ?? []);
    setLoadingComments(false);
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/work" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-black/5">
          ← 업무로 돌아가기
        </Link>
        <h1 className="ml-1 text-lg font-bold text-slate-800">🗂 업무기록</h1>
        <span className="text-xs text-slate-400">완료된 업무가 연도·학기·날짜별로 보관됩니다</span>

        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            <option value="all">전체 부서</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button
              onClick={() => setScope("all")}
              className={"rounded-md px-2.5 py-1 font-semibold transition " + (scope === "all" ? "bg-blue-500 text-white" : "text-slate-500 hover:bg-black/5")}
            >
              전체
            </button>
            <button
              onClick={() => setScope("mine")}
              className={"rounded-md px-2.5 py-1 font-semibold transition " + (scope === "mine" ? "bg-blue-500 text-white" : "text-slate-500 hover:bg-black/5")}
            >
              내 기록
            </button>
          </div>
        </div>
      </div>

      {years.length === 0 && (
        <div className="glass flex flex-col items-center gap-1 p-10 text-center text-sm text-slate-400">
          <span>아직 보관된 업무기록이 없습니다.</span>
          <span className="text-xs">업무보드에서 완료한 업무는 다음날 자동으로 여기에 쌓입니다.</span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {years.map((yg) => {
          const yearKey = `y:${yg.year}`;
          const yearOpen = !collapsedKeys[yearKey];
          const yearCount = yg.termGroups.reduce((sum, tg) => sum + tg.dates.reduce((s, d) => s + d.tasks.length, 0), 0);
          return (
            <div key={yg.year} className="glass overflow-hidden">
              <button
                onClick={() => toggle(yearKey)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-black/[0.02]"
              >
                <span>{yearOpen ? "▾" : "▸"}</span>
                <span>{yg.year}년</span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{yearCount}건</span>
              </button>
              {yearOpen && (
                <div className="flex flex-col gap-2 px-4 pb-3">
                  {yg.termGroups.map((tg) => {
                    const termKey = `t:${yg.year}:${tg.key}`;
                    const termOpen = !collapsedKeys[termKey];
                    const termCount = tg.dates.reduce((s, d) => s + d.tasks.length, 0);
                    return (
                      <div key={tg.key} className="rounded-lg border border-slate-100">
                        <button
                          onClick={() => toggle(termKey)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-slate-600 hover:bg-black/[0.02]"
                        >
                          <span>{termOpen ? "▾" : "▸"}</span>
                          <span>📘 {tg.label}</span>
                          <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">{termCount}건</span>
                        </button>
                        {termOpen && (
                          <div className="flex flex-col gap-2 px-3 pb-2.5">
                            {tg.dates.map((dg) => (
                              <div key={dg.dateKey}>
                                <div className="mb-1 px-1 text-[11px] font-semibold text-slate-400">{dg.label}</div>
                                <div className="flex flex-col gap-1">
                                  {dg.tasks.map((task) => {
                                    const color = task.department ? deptColorMap.get(task.department) : null;
                                    const isExpanded = expandedTaskId === task.id;
                                    const onTime = task.due_at && task.completed_at ? task.completed_at <= task.due_at : null;
                                    return (
                                      <div key={task.id} className="overflow-hidden rounded-lg border border-slate-100 bg-white/60">
                                        <button
                                          onClick={() => toggleExpand(task.id)}
                                          style={{ borderLeftColor: color || "#94a3b8" }}
                                          className="flex w-full flex-wrap items-center gap-2 border-l-4 px-3 py-2 text-left text-[12px] hover:bg-black/[0.02]"
                                        >
                                          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{task.title}</span>
                                          {task.priority === "긴급" && (
                                            <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">긴급</span>
                                          )}
                                          {onTime !== null && (
                                            <span
                                              className={
                                                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                                                (onTime ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600")
                                              }
                                            >
                                              {onTime ? "정시 완료" : "지연 완료"}
                                            </span>
                                          )}
                                          <span className="shrink-0 text-[11px] text-slate-400">
                                            {task.completed_at ? fmtTime(task.completed_at) : ""}
                                          </span>
                                        </button>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                                          <span>📝 제안: {nameFor(team, task.owner_email)}</span>
                                          <span>
                                            👤 담당:{" "}
                                            {task.assignee_emails.length > 0
                                              ? task.assignee_emails.map((e) => nameFor(team, e)).join(", ")
                                              : "미지정"}
                                          </span>
                                          {task.updated_by && <span>✅ 완료 처리: {nameFor(team, task.updated_by)}</span>}
                                          {task.department && <span>🏷 {task.department}</span>}
                                        </div>
                                        {isExpanded && (
                                          <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2">
                                            {task.resolution_note && (
                                              <div className="mb-2 rounded-md bg-white p-2 text-[11px] text-slate-600">
                                                <span className="font-semibold text-slate-500">📝 처리사항</span>
                                                <p className="mt-0.5 whitespace-pre-wrap">{task.resolution_note}</p>
                                              </div>
                                            )}
                                            {loadingComments ? (
                                              <div className="text-[11px] text-slate-400">불러오는 중...</div>
                                            ) : comments.length === 0 ? (
                                              <div className="text-[11px] text-slate-300">기록된 코멘트/이력이 없습니다.</div>
                                            ) : (
                                              <div className="flex flex-col gap-1">
                                                {comments.map((c) => (
                                                  <div key={c.id} className="text-[11px]">
                                                    {c.is_system ? (
                                                      <span className="italic text-slate-400">
                                                        🔔 {c.content} · {timeLabel(c.created_at)}
                                                      </span>
                                                    ) : (
                                                      <span className="text-slate-600">
                                                        <span className="font-semibold">{nameFor(team, c.author_email)}</span>: {c.content}{" "}
                                                        <span className="text-slate-300">· {timeLabel(c.created_at)}</span>
                                                      </span>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
