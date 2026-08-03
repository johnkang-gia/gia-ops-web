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
  modeColorMap,
  isAdmin,
  currentUserEmail,
  onOpen,
  onToggleAcknowledge,
}: {
  task: Task;
  team: TeamMember[];
  deptColor?: string | null;
  modeColorMap?: Map<string, string>;
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

  // 카드 강조색은 "누구를 위한 업무인가"(나/전체/공유, 관리자가 설정)를 우선 기준으로 삼고,
  // 아직 색이 지정 안 됐거나 예전 데이터라면 부서색 → 기본 파란색 순으로 대신합니다.
  const color = modeColorMap?.get(task.origin_mode) || deptColor || "#3b82f6";
  const ackList = task.acknowledged_by ?? [];
  const totalAssignees = task.assignee_emails.length;
  const iAmAssignee = task.assignee_emails.includes(currentUserEmail);
  const myAck = ackList.some((a) => a.email === currentUserEmail);
  const needsMyAck = iAmAssignee && task.status !== "완료" && !myAck;
  // 마감이 지났는데 아직 완료가 아니면 "지연", 24시간 안에 마감이면 "임박" - 팀이 업무가
  // 밀리는 걸 눈으로 바로 알아채도록 테두리 색과 뱃지로 강하게 표시합니다.
  const dueTime = task.due_at ? new Date(task.due_at).getTime() : null;
  const overdue = dueTime !== null && task.status !== "완료" && dueTime < Date.now();
  const dueSoon = !overdue && dueTime !== null && task.status !== "완료" && dueTime - Date.now() < 24 * 60 * 60 * 1000;
  const deadline = deadlineLabel(task.due_at);
  const unacknowledged = task.assignee_emails.filter((e) => !ackList.some((a) => a.email === e));
  const borderColor = overdue ? "#ef4444" : dueSoon ? "#f59e0b" : color;
  const urgencyRing = overdue ? "ring-2 ring-red-400" : dueSoon ? "ring-1 ring-amber-300" : needsMyAck ? "ring-1 ring-amber-400" : "";

  const assigneeSummary =
    totalAssignees === 0
      ? null
      : totalAssignees === 1
        ? `@${nameFor(team, task.assignee_emails[0])}`
        : `@${nameFor(team, task.assignee_emails[0])} 외 ${totalAssignees - 1}명`;

  // 완료로 바뀐 순간부터는(다음날 밤 크론이 업무기록으로 옮기기 전까지) 칸반에서 제목만
  // 보이는 얇은 줄로 접어둡니다 - 다 끝난 일이 여전히 큰 카드로 자리를 차지하며 눈에 띄면
  // "아직 할 일"과 시각적으로 구분이 안 되기 때문입니다. 클릭하면 평소처럼 상세 패널이 열립니다.
  if (task.status === "완료") {
    return (
      <div
        ref={setNodeRef}
        style={{ ...style, borderLeftColor: color }}
        className="glass mb-1.5 flex cursor-grab items-center gap-1.5 overflow-hidden rounded-lg border-l-4 px-3 py-1.5 opacity-70 shadow-sm transition hover:opacity-100"
        {...attributes}
        {...listeners}
        onClick={onOpen}
      >
        <span className="shrink-0 text-xs">✅</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-slate-500 line-through">{task.title}</span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeftColor: borderColor }}
      className={"glass mb-2 cursor-grab overflow-hidden rounded-lg border-l-4 p-3 shadow-sm transition " + urgencyRing}
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
        <span className={"min-w-0 flex-1 text-sm font-semibold text-slate-800" + (iAmAssignee && myAck ? " opacity-60" : "")}>
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
        <span className="flex items-center gap-1">
          {overdue && (
            <span className="animate-pulse rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">🔥 지연</span>
          )}
          {dueSoon && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">⏰ 임박</span>}
          <span className={overdue ? "font-semibold text-red-500" : dueSoon ? "font-semibold text-amber-600" : ""}>{deadline ?? ""}</span>
        </span>
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
