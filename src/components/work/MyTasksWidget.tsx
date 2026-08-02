"use client";

import type { Task } from "@/lib/types";
import { STATUS_LABEL, STATUS_COLOR } from "./statusConfig";
import { deadlineLabel } from "@/lib/deadlineLabel";

// 우측 상단에 "내 업무목록" 위젯 - 나에게 배정된(완료 제외) 업무만 마감 임박 순으로 모아 보여줘서,
// 굳이 칸반 전체를 훑지 않아도 내가 지금 처리해야 할 일이 한눈에 들어오게 했습니다.
export default function MyTasksWidget({
  tasks,
  currentUserEmail,
  onOpenTask,
}: {
  tasks: Task[];
  currentUserEmail: string;
  onOpenTask: (id: string) => void;
}) {
  const mine = tasks
    .filter((t) => t.assignee_emails?.includes(currentUserEmail) && t.status !== "완료")
    .sort((a, b) => {
      const at = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bt = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return at - bt;
    });

  return (
    <div className="glass flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between text-[13px] font-bold text-blue-600">
        <span>🙋 내 업무목록</span>
        <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[11px] text-slate-600">{mine.length}건</span>
      </div>
      {mine.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs opacity-40">배정된 업무가 없습니다</div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {mine.map((task) => {
            const overdue = task.due_at && new Date(task.due_at).getTime() < Date.now();
            const deadline = deadlineLabel(task.due_at);
            return (
              <button
                key={task.id}
                onClick={() => onOpenTask(task.id)}
                style={{ borderLeftColor: STATUS_COLOR[task.status] }}
                className="flex items-center gap-2 rounded-lg border-l-[3px] bg-black/[0.02] px-2.5 py-1.5 text-left text-[12px] transition hover:bg-black/5"
              >
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {deadline && <span className={"shrink-0 text-[10px] font-semibold " + (overdue ? "text-red-500" : "opacity-50")}>{deadline}</span>}
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ backgroundColor: STATUS_COLOR[task.status] + "22", color: STATUS_COLOR[task.status] }}
                >
                  {STATUS_LABEL[task.status]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
