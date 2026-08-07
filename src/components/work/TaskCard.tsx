"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task, TaskStatus, TeamMember } from "@/lib/types";
import { nameFor } from "@/lib/teamName";
import { deadlineLabel } from "@/lib/deadlineLabel";
import { recurrenceLabel } from "@/lib/recurrence";
import { STATUS_ORDER, STATUS_LABEL } from "./statusConfig";

export default function TaskCard({
  task,
  team,
  deptColor,
  modeColorMap,
  isAdmin,
  currentUserEmail,
  onOpen,
  onToggleAcknowledge,
  onChangeStatus,
}: {
  task: Task;
  team: TeamMember[];
  deptColor?: string | null;
  modeColorMap?: Map<string, string>;
  isAdmin: boolean;
  currentUserEmail: string;
  onOpen: () => void;
  onToggleAcknowledge: (checked: boolean) => void;
  onChangeStatus: (status: TaskStatus) => void;
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
  // 업무를 등록한 사람(owner_email) 본인은 "확인"할 필요가 없는 당사자라, 확인 대상
  // 목록에서는 제외합니다(요청: "업무등록한 사람은 확인목록에서 제외시켜주고"). [전체] 모드는
  // 부서원 전원(등록자 포함)을 담당자로 넣기 때문에 예전에는 등록자 본인도 "확인 안 함"으로
  // 남아있었습니다. 담당자 요약 표시(@아무개 외 N명)는 실제 배정 인원 그대로 보여주고,
  // 확인 체크박스/현황만 이 필터링된 목록 기준으로 계산합니다.
  const ackRequiredEmails = task.assignee_emails.filter((e) => e !== task.owner_email);
  const totalAckRequired = ackRequiredEmails.length;
  const ackListRequired = ackList.filter((a) => ackRequiredEmails.includes(a.email));
  const iAmAssignee = ackRequiredEmails.includes(currentUserEmail);
  const myAck = ackList.some((a) => a.email === currentUserEmail);
  const needsMyAck = iAmAssignee && task.status !== "완료" && !myAck;
  // 마감이 지났는데 아직 완료가 아니면 "지연", 24시간 안에 마감이면 "임박" - 팀이 업무가
  // 밀리는 걸 눈으로 바로 알아채도록 테두리 색과 뱃지로 강하게 표시합니다.
  const dueTime = task.due_at ? new Date(task.due_at).getTime() : null;
  const overdue = dueTime !== null && task.status !== "완료" && dueTime < Date.now();
  const dueSoon = !overdue && dueTime !== null && task.status !== "완료" && dueTime - Date.now() < 24 * 60 * 60 * 1000;
  const deadline = deadlineLabel(task.due_at);
  const unacknowledged = ackRequiredEmails.filter((e) => !ackList.some((a) => a.email === e));
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
        className="glass mb-1.5 flex items-center gap-1.5 overflow-hidden rounded-lg border-l-4 px-3 py-1.5 opacity-70 shadow-sm transition hover:opacity-100"
        {...attributes}
      >
        <span className="shrink-0 text-xs">✅</span>
        <span
          {...listeners}
          onClick={onOpen}
          className="min-w-0 flex-1 cursor-grab truncate text-[13px] text-slate-500 line-through active:cursor-grabbing"
        >
          {task.title}
        </span>
        <select
          value={task.status}
          onChange={(e) => onChangeStatus(e.target.value as TaskStatus)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          title="상태를 바로 바꾸기 (드래그 없이도 가능)"
          className="shrink-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // 평소에는 제목 + 확인여부 + 마감기한만 있는 얇은 "바"로 두고, 마우스를 올리면 그 아래로
  // 상세(내용·담당자·확인현황·상태 바꾸기)가 펼쳐집니다(요청: "등록당시에는 제목하고 확인여부,
  // 마감기한만 뜨도록하고, 마우스를 업무바 위에 올리면 펼쳐지면서 확인현황등이 뜨고"). 이렇게
  // 하면 흐름판에 업무가 여러 건 쌓여도 한 화면에 한눈에 들어옵니다.
  //
  // 드래그(listeners)는 카드 전체가 아니라 제목 영역에만 붙였습니다(요청: "제목쪽을 드래그해서
  // 옮기도록") - 펼쳐진 상태에서 체크박스·드롭다운을 누를 때 카드가 딸려 움직이지 않습니다.
  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeftColor: borderColor }}
      className={"glass group mb-1.5 overflow-hidden rounded-lg border-l-4 shadow-sm transition " + urgencyRing}
      {...attributes}
    >
      {/* 항상 보이는 한 줄: 확인 체크 · 제목(드래그 손잡이) · 마감 */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        {iAmAssignee && (
          <input
            type="checkbox"
            checked={myAck}
            onChange={(e) => onToggleAcknowledge(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer"
            title="업무 확인"
          />
        )}
        {task.priority === "긴급" && (
          <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold text-red-600">긴급</span>
        )}
        {task.recurrence && (
          <span title={recurrenceLabel(task.recurrence)} className="shrink-0 text-[10px]">
            🔁
          </span>
        )}
        <span
          {...listeners}
          onClick={onOpen}
          title="드래그해서 다른 칸으로 옮기거나, 클릭해서 상세를 엽니다"
          className={
            "min-w-0 flex-1 cursor-grab truncate text-[13px] font-semibold text-slate-800 active:cursor-grabbing" +
            (iAmAssignee && myAck ? " opacity-60" : "")
          }
        >
          {task.title}
        </span>
        {overdue && <span className="shrink-0 animate-pulse text-[10px]">🔥</span>}
        {dueSoon && <span className="shrink-0 text-[10px]">⏰</span>}
        {deadline && (
          <span
            className={
              "shrink-0 text-[10px] " +
              (overdue ? "font-semibold text-red-500" : dueSoon ? "font-semibold text-amber-600" : "text-slate-400")
            }
          >
            {deadline}
          </span>
        )}
      </div>

      {/* 마우스를 올렸을 때만 펼쳐지는 상세 영역 */}
      <div className="hidden border-t border-dashed border-slate-200 px-2.5 py-1.5 group-hover:block">
        {task.description && <div className="mb-1 text-[11px] text-slate-500">{task.description}</div>}

        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
          {assigneeSummary && <span>👤 {assigneeSummary}</span>}
          {totalAckRequired > 0 && (
            <span className="font-semibold text-slate-400">
              확인 {ackListRequired.length}/{totalAckRequired}
            </span>
          )}
        </div>

        {totalAckRequired > 0 && (
          <div className="mt-1 flex flex-col gap-0.5 text-[10px]">
            {ackListRequired.length > 0 && (
              <div className="text-emerald-600">{ackListRequired.map((a) => `✓ ${nameFor(team, a.email)}`).join(" · ")}</div>
            )}
            {unacknowledged.length > 0 && (
              <div className="text-red-500">! 미확인: {unacknowledged.map((e) => nameFor(team, e)).join(", ")}</div>
            )}
          </div>
        )}

        {/* 드래그가 불편한 터치 환경(모바일/태블릿)에서도 상태를 바로 바꿀 수 있는 대체 수단입니다. */}
        <div className="mt-1.5 flex justify-end">
          <select
            value={task.status}
            onChange={(e) => onChangeStatus(e.target.value as TaskStatus)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            title="상태를 바로 바꾸기 (드래그 없이도 가능)"
            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
