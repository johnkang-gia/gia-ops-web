"use client";

import type { Task, TaskStatus, TeamMember } from "@/lib/types";
import { nameFor } from "@/lib/teamName";
import { STATUS_ORDER, STATUS_LABEL } from "./statusConfig";

export default function TaskCard({
  task,
  team,
  deptColor,
  onOpen,
  onDragStartTask,
  onStatusChange,
}: {
  task: Task;
  team: TeamMember[];
  deptColor?: string | null;
  onOpen: () => void;
  onDragStartTask: (e: React.DragEvent, taskId: string) => void;
  onStatusChange: (status: TaskStatus) => void;
}) {
  const overdue = task.due_at && task.status !== "완료" && new Date(task.due_at).getTime() < Date.now();
  const ackCount = task.acknowledged_by?.length ?? 0;
  const totalAssignees = task.assignee_emails.length;
  const color = deptColor || "#c6a15b";

  return (
    <div
      draggable
      onDragStart={(e) => onDragStartTask(e, task.id)}
      onClick={onOpen}
      style={{ borderLeftColor: task.department ? color : undefined, borderLeftWidth: task.department ? 4 : 1 }}
      className={
        "cursor-pointer rounded-xl border bg-white p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md " +
        (overdue ? "border-red-300" : "border-slate-200")
      }
    >
      <div className="mb-1.5 flex items-start gap-1.5">
        {task.priority === "긴급" && (
          <span className="mt-0.5 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
            긴급
          </span>
        )}
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{task.title}</span>
      </div>

      {task.department && (
        <div className="mb-1.5">
          <span
            style={{ backgroundColor: color + "22", color }}
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          >
            🏫 {task.department}
          </span>
        </div>
      )}

      {totalAssignees > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {task.assignee_emails.map((email) => {
            const acked = task.acknowledged_by?.some((a) => a.email === email);
            return (
              <span
                key={email}
                className={
                  "rounded-full px-1.5 py-0.5 text-[10px] " +
                  (acked ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500")
                }
              >
                {acked ? "✅" : "👤"} {nameFor(team, email)}
              </span>
            );
          })}
          <span className="ml-auto rounded-full bg-gia-navy/5 px-1.5 py-0.5 text-[10px] font-semibold text-gia-navy">
            확인 {ackCount}/{totalAssignees}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-1">
        {task.due_at ? (
          <span className={"text-[10px] " + (overdue ? "font-semibold text-red-500" : "text-slate-400")}>
            🕐 {new Date(task.due_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : (
          <span />
        )}
        <select
          value={task.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
          className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] text-slate-500"
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
