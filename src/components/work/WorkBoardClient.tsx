"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
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
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-600">
          💬 채팅에서 @담당자를 태그하면 바로 업무로 등록돼요
        </span>
      </div>

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
