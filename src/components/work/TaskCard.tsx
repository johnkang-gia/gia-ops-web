"use client";

import type { Task, TaskStatus } from "@/lib/types";

const STATUS_ORDER: TaskStatus[] = ["예정", "진행중", "완료", "보류"];

function shortName(email: string) {
  return email.split("@")[0];
}

export default function TaskCard({
  task,
  onOpen,
  onDragStartTask,
  onStatusChange,
}: {
  task: Task;
  onOpen: () => void;
  onDragStartTask: (e: React.DragEvent, taskId: string) => void;
  onStatusChange: (status: TaskStatus) => void;
}) {
  const overdue = task.due_at && task.status !== "완료" && new Date(task.due_at).getTime() < Date.now();

  return (
    <div
      draggable
      onDragStart={(e) => onDragStartTask(e, task.id)}
      onClick={onOpen}
      className={
        "cursor-pointer rounded-lg border bg-white p-2.5 text-left shadow-sm transition hover:border-blue-300 hover:shadow " +
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

      {task.assignee_emails.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.assignee_emails.map((email) => (
            <span key={email} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
              👤 {shortName(email)}
            </span>
          ))}
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
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
