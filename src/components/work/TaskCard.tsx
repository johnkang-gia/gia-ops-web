"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task, TeamMember } from "@/lib/types";
import { nameFor } from "@/lib/teamName";
import { deadlineLabel } from "@/lib/deadlineLabel";

export default function TaskCard({
  task,
  team,
  deptColor,
  isAdmin,
  currentUserEmail,
  onOpen,
  onToggleAcknowledge,
}: {
  task: Task;
  team: TeamMember[];
  deptColor?: string | null;
  isAdmin: boolean;
  currentUserEmail: string;
  onOpen: () => void;
  onToggleAcknowledge: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "Task", task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const color = deptColor || "#3b82f6";
  const ackList = task.acknowledged_by ?? [];
  const totalAssignees = task.assignee_emails.length;
  const iAmAssignee = task.assignee_emails.includes(currentUserEmail);
  const myAck = ackList.some((a) => a.email === currentUserEmail);
  const needsMyAck = iAmAssignee && task.status !== "완료" && !myAck;
  const overdue = task.due_at && task.status !== "완료" && new Date(task.due_at).getTime() < Date.now();
  const deadline = deadlineLabel(task.due_at);
  const unacknowledged = task.assignee_emails.filter((e) => !ackList.some((a) => a.email === e));

  const assigneeSummary =
    totalAssignees === 0
      ? null
      : totalAssignees === 1
        ? `@${nameFor(team, task.assignee_emails[0])}`
        : `@${nameFor(team, task.assignee_emails[0])} 외 ${totalAssignees - 1}명`;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeftColor: color }}
      className={"glass mb-2 cursor-grab overflow-hidden rounded-lg border-l-4 p-3 shadow-sm transition " + (needsMyAck ? "ring-1 ring-amber-400" : "")}
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
      <div className="mb-1.5 flex items-start gap-2">
        {iAmAssignee && (
          <input
            type="checkbox"
            checked={myAck}
            onChange={(e) => onToggleAcknowledge(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
            title="업무 확인"
          />
        )}
        {task.priority === "긴급" && (
          <span className="mt-0.5 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
            긴급
          </span>
        )}
        <span className={"min-w-0 flex-1 text-sm font-semibold text-slate-800" + (iAmAssignee && myAck ? " line-through opacity-60" : "")}>
          {task.title}
        </span>
        {totalAssignees > 0 && (
          <span className="shrink-0 text-[10px] font-semibold text-slate-400">
            확인 {ackList.length}/{totalAssignees}
          </span>
        )}
      </div>

      {task.description && <div className="mb-2 text-xs text-slate-500">{task.description}</div>}

      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className={overdue ? "font-semibold text-red-500" : ""}>{deadline ?? ""}</span>
        {assigneeSummary && <span>👤 {assigneeSummary}</span>}
      </div>

      {isAdmin && totalAssignees > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-dashed border-slate-200 pt-2 text-[11px]">
          <div className="font-semibold text-slate-400">[관리자] 확인 현황 ({ackList.length}/{totalAssignees})</div>
          {ackList.length > 0 && (
            <div className="text-emerald-600">
              {ackList.map((a) => `✓ ${nameFor(team, a.email)}`).join(" · ")}
            </div>
          )}
          {unacknowledged.length > 0 && (
            <div className="text-red-500">! 미확인: {unacknowledged.map((e) => nameFor(team, e)).join(", ")}</div>
          )}
        </div>
      )}
    </div>
  );
}
