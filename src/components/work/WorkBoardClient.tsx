"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import { genCaseId } from "@/lib/caseId";
import type { Task, TaskStatus, Department, TeamMember } from "@/lib/types";
import { nameFor } from "@/lib/teamName";
import { STATUS_LABEL } from "./statusConfig";
import WorkspaceArea from "./WorkspaceArea";
import TaskDetailPanel from "./TaskDetailPanel";

export default function WorkBoardClient({
  initialTasks,
  team,
  userEmail,
  departments,
  isAdmin,
}: {
  initialTasks: Task[];
  team: TeamMember[];
  userEmail: string;
  departments: Department[];
  isAdmin: boolean;
}) {
  const [tasks, setTasks] = useRealtimeTable<Task>("tasks", initialTasks);
  const [deptList, setDeptList] = useState<Department[]>(departments);
  const online = useOnlineUsers(userEmail);

  const [activeDeptId, setActiveDeptId] = useState<string | null>(deptList[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"보통" | "긴급">("보통");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const activeDepartment = deptList.find((d) => d.id === activeDeptId) ?? deptList[0] ?? null;

  const deptColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deptList) if (d.color) map.set(d.name, d.color);
    return map;
  }, [deptList]);

  const scopedTasks = useMemo(
    () => (activeDepartment ? tasks.filter((t) => t.department === activeDepartment.name) : []),
    [tasks, activeDepartment]
  );

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  function addTaskRow(task: Task) {
    setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
  }

  async function handleColorChange(dept: Department, color: string) {
    if (!isAdmin) return;
    setDeptList((prev) => prev.map((d) => (d.id === dept.id ? { ...d, color } : d)));
    const supabase = createClient();
    await supabase.from("departments").update({ color }).eq("id", dept.id);
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !activeDepartment) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({
        case_id: genCaseId("TSK"),
        title: title.trim(),
        description: description.trim() || null,
        status: "예정",
        priority,
        department: activeDepartment.name,
        owner_email: userEmail,
        assignee_emails: assignees,
        position: Date.now(),
      })
      .select()
      .single();
    if (data) addTaskRow(data as Task);
    setTitle("");
    setDescription("");
    setPriority("보통");
    setAssignees([]);
    setShowAddForm(false);
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

  async function toggleAck(taskId: string, checked: boolean) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const already = task.acknowledged_by?.some((a) => a.email === userEmail);
    if (checked === !!already) return;
    const nextAck = checked
      ? [...(task.acknowledged_by ?? []), { email: userEmail, time: new Date().toISOString() }]
      : (task.acknowledged_by ?? []).filter((a) => a.email !== userEmail);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, acknowledged_by: nextAck } : t)));
    const supabase = createClient();
    await supabase.from("tasks").update({ acknowledged_by: nextAck }).eq("id", taskId);
    if (checked) {
      await supabase.from("task_comments").insert({
        task_id: taskId,
        author_email: userEmail,
        content: `${nameFor(team, userEmail)}님이 업무를 확인했습니다.`,
        department: task.department,
        is_system: true,
      });
    }
  }

  function toggleAssignee(email: string) {
    setAssignees((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]));
  }

  if (!activeDepartment) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">
        등록된 부서가 없습니다. 먼저 부서를 추가해주세요.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 부서 선택 - 참조 소스코드의 좌측 세로 부서 목록 대신, 이미 있는 메인 사이드바와 중복되지
          않도록 상단 가로 탭으로 배치했습니다(색상 점 클릭 시 관리자만 색상 변경 가능한 것은 동일). */}
      <div className="glass-panel flex shrink-0 flex-wrap items-center gap-1 border-b border-black/5 px-3 py-2">
        {deptList.map((dept) => {
          const active = dept.id === activeDeptId;
          return (
            <button
              key={dept.id}
              onClick={() => setActiveDeptId(dept.id)}
              style={active ? { backgroundColor: dept.color + "22", color: dept.color } : undefined}
              className={"flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition " + (active ? "" : "text-slate-500 hover:bg-black/5")}
            >
              <span className="relative inline-block h-2.5 w-2.5 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: dept.color }}>
                {isAdmin && (
                  <input
                    type="color"
                    value={dept.color}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleColorChange(dept, e.target.value)}
                    className="absolute -left-1/2 -top-1/2 h-[200%] w-[200%] cursor-pointer opacity-0"
                    title={`${dept.name} 색상 변경 (관리자 전용)`}
                  />
                )}
              </span>
              {dept.name}
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-[11px] text-slate-500">
          🟢 {online.length}명 접속중
        </span>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-full bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600"
        >
          + 새 업무
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={addTask} className="glass m-2 flex shrink-0 flex-col gap-2 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="업무 제목"
              className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm"
              autoFocus
            />
            <select value={priority} onChange={(e) => setPriority(e.target.value as "보통" | "긴급")} className="rounded-lg border border-black/10 bg-white/80 px-2 py-2 text-xs">
              <option value="보통">보통</option>
              <option value="긴급">🔴 긴급</option>
            </select>
            <button type="submit" disabled={saving || !title.trim()} className="shrink-0 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50">
              등록
            </button>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="설명(선택)"
            className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] opacity-50">담당자 태그:</span>
            {team.map((member) => {
              const active = assignees.includes(member.email);
              return (
                <button
                  key={member.email}
                  type="button"
                  onClick={() => toggleAssignee(member.email)}
                  className={"rounded-full border px-2 py-0.5 text-[11px] transition " + (active ? "border-blue-500 bg-blue-500 text-white" : "border-black/10 bg-white/70 text-slate-500")}
                >
                  {nameFor(team, member.email)}
                </button>
              );
            })}
          </div>
        </form>
      )}

      <div className="flex-1 overflow-hidden">
        <WorkspaceArea
          activeDepartment={activeDepartment}
          tasks={scopedTasks}
          team={team}
          deptColorMap={deptColorMap}
          departments={deptList}
          isAdmin={isAdmin}
          currentUserEmail={userEmail}
          onOpenTask={setSelectedId}
          onChangeStatus={changeStatus}
          onToggleAck={toggleAck}
          onTaskCreated={addTaskRow}
        />
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
