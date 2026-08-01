"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import { genCaseId } from "@/lib/caseId";
import type { Task, TaskStatus, Department, TeamMember } from "@/lib/types";
import { nameFor } from "@/lib/teamName";
import TaskCard from "./TaskCard";
import TaskDetailPanel from "./TaskDetailPanel";
import ChatPanel from "./ChatPanel";
import CompletionGauge from "./CompletionGauge";
import ActivityLog from "./ActivityLog";
import { STATUS_ORDER, STATUS_LABEL, STATUS_STYLE } from "./statusConfig";

export default function WorkBoardClient({
  initialTasks,
  team,
  userEmail,
  departments,
}: {
  initialTasks: Task[];
  team: TeamMember[];
  userEmail: string;
  departments: Department[];
}) {
  const [tasks, setTasks] = useRealtimeTable<Task>("tasks", initialTasks);
  const online = useOnlineUsers(userEmail);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"보통" | "긴급">("보통");
  const [department, setDepartment] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [showCompletedAll, setShowCompletedAll] = useState(false);
  // 등록된 부서가 있으면(지금은 초등부) 기본으로 그 부서를 바로 보여줍니다. 나중에 유치부/중고등부가
  // 추가되면 departments 테이블에 행만 더 넣으면 자동으로 탭에 나타납니다.
  const [deptFilter, setDeptFilter] = useState(departments[0]?.name ?? "전체");

  const allDepartmentNames = useMemo(() => {
    const fromTable = departments.map((d) => d.name);
    const fromTasks = tasks.map((t) => t.department).filter((d): d is string => !!d);
    return [...new Set([...fromTable, ...fromTasks])];
  }, [departments, tasks]);

  const deptColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments) if (d.color) map.set(d.name, d.color);
    return map;
  }, [departments]);

  const scopedTasks = deptFilter === "전체" ? tasks : tasks.filter((t) => t.department === deptFilter);

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { 예정: [], 진행중: [], 완료: [], 보류: [] };
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const t of scopedTasks) {
      if (t.status === "완료" && !showCompletedAll && new Date(t.updated_at).getTime() < fourteenDaysAgo) continue;
      map[t.status].push(t);
    }
    for (const s of STATUS_ORDER) map[s].sort((a, b) => a.position - b.position);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedTasks, showCompletedAll]);

  const completionPercent = scopedTasks.length
    ? Math.round((scopedTasks.filter((t) => t.status === "완료").length / scopedTasks.length) * 100)
    : 0;

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  function addTaskRow(task: Task) {
    setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({
        case_id: genCaseId("TSK"),
        title: title.trim(),
        status: "예정",
        priority,
        department: department.trim() || null,
        owner_email: userEmail,
        assignee_emails: assignees,
        position: Date.now(),
      })
      .select()
      .single();
    if (data) addTaskRow(data as Task);
    setTitle("");
    setPriority("보통");
    setAssignees([]);
    setSaving(false);
  }

  async function changeStatus(taskId: string, status: TaskStatus) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    const position = Date.now();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status, position } : t)));
    const supabase = createClient();
    await supabase.from("tasks").update({ status, position }).eq("id", taskId);
    await supabase.from("task_comments").insert({
      task_id: taskId,
      author_email: userEmail,
      content: `${nameFor(team, userEmail)}님이 업무를 '${STATUS_LABEL[status]}'(으)로 변경했습니다.`,
      department: task.department,
      is_system: true,
    });
  }

  function toggleAssignee(email: string) {
    setAssignees((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]));
  }

  return (
    <div className="relative rounded-3xl bg-gradient-to-br from-gia-navy/5 via-white to-gia-gold-soft/20 p-3 sm:p-5">
      <datalist id="dept-options">
        {allDepartmentNames.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">
        <span className="font-semibold text-slate-600">🟢 지금 접속 중:</span>
        {online.length === 0 && <span>없음</span>}
        {online.map((email) => (
          <span key={email} className="rounded-full bg-slate-100 px-2 py-0.5">
            {email === userEmail ? "나" : nameFor(team, email)}
          </span>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {["전체", ...allDepartmentNames].map((d) => {
          const color = deptColorMap.get(d);
          const active = d === deptFilter;
          return (
            <button
              key={d}
              onClick={() => setDeptFilter(d)}
              style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition " +
                (active
                  ? color
                    ? "text-white"
                    : "border-gia-navy bg-gia-navy text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
              }
            >
              {!active && color && (
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              )}
              {d}
            </button>
          );
        })}
      </div>

      <ActivityLog department={deptFilter} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {deptFilter !== "전체" && (
            <div className="mb-3">
              <CompletionGauge percent={completionPercent} label={`${deptFilter} 업무`} />
            </div>
          )}

          <form
            onSubmit={addTask}
            className="mb-5 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex flex-wrap gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="새 업무 등록 (예: 학부모 안내문 발송)"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <input
                list="dept-options"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="부서(선택)"
                className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as "보통" | "긴급")}
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
              >
                <option value="보통">보통</option>
                <option value="긴급">🔴 긴급</option>
              </select>
              <button
                type="submit"
                disabled={saving || !title.trim()}
                className="shrink-0 rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
              >
                등록
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">담당자 태그:</span>
              {team.map((member) => {
                const active = assignees.includes(member.email);
                return (
                  <button
                    key={member.email}
                    type="button"
                    onClick={() => toggleAssignee(member.email)}
                    className={
                      "rounded-full border px-2 py-0.5 text-[11px] transition " +
                      (active
                        ? "border-gia-navy bg-gia-navy text-white"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")
                    }
                  >
                    {online.includes(member.email) && <span className="mr-0.5">🟢</span>}
                    {nameFor(team, member.email)}
                  </button>
                );
              })}
            </div>
          </form>

          <div className="mb-2 flex justify-end">
            <label className="flex items-center gap-1 text-[11px] text-slate-400">
              <input type="checkbox" checked={showCompletedAll} onChange={(e) => setShowCompletedAll(e.target.checked)} />
              완료된 업무 전체 보기(기본은 최근 14일)
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {STATUS_ORDER.map((status) => (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStatus(status);
                }}
                onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData("text/plain");
                  changeStatus(taskId, status);
                  setDragOverStatus(null);
                }}
                className={
                  "flex min-h-[200px] flex-col gap-2 rounded-2xl border p-2 shadow-sm transition " +
                  (dragOverStatus === status ? "border-gia-navy-light " + STATUS_STYLE[status].drop : "border-slate-200 bg-white")
                }
              >
                <div className={"flex items-center justify-between px-1 text-xs font-bold " + STATUS_STYLE[status].header}>
                  <span>{STATUS_LABEL[status]}</span>
                  <span className="text-slate-300">{grouped[status].length}</span>
                </div>
                {grouped[status].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    team={team}
                    deptColor={task.department ? deptColorMap.get(task.department) : null}
                    onOpen={() => setSelectedId(task.id)}
                    onDragStartTask={(e, id) => e.dataTransfer.setData("text/plain", id)}
                    onStatusChange={(s) => changeStatus(task.id, s)}
                  />
                ))}
                {grouped[status].length === 0 && (
                  <p className="px-1 text-[11px] text-slate-300">여기로 카드를 끌어다 놓을 수 있어요</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          {deptFilter !== "전체" ? (
            <ChatPanel
              department={deptFilter}
              departments={departments}
              team={team}
              userEmail={userEmail}
              onTaskCreated={addTaskRow}
            />
          ) : (
            <div className="flex h-[200px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-400 shadow-sm">
              부서 탭을 선택하면
              <br />
              실시간 채팅을 볼 수 있어요
            </div>
          )}
        </div>
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          team={team}
          online={online}
          currentUserEmail={userEmail}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
          onDeleted={(id) => {
            setTasks((prev) => prev.filter((t) => t.id !== id));
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
