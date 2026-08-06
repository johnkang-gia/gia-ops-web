"use client";

import type { Task } from "@/lib/types";
import { STATUS_LABEL, STATUS_COLOR } from "./statusConfig";
import { deadlineLabel } from "@/lib/deadlineLabel";

// MyTasksWidget(내 업무목록)/AllTasksWidget(전체 업무목록)이 공유하는 목록 렌더링입니다.
// 두 위젯은 "어떤 업무를 보여줄지"(필터링)만 다르고 나머지 생김새는 완전히 같아서, 실제
// 목록을 그리는 부분만 여기로 뽑아뒀습니다(요청: "업무메뉴의 내 업무목록을 반으로 나눠서
// 한쪽은 내업무목록, 다른쪽은 전체 업무목록으로 표시되도록").
export default function TaskListPane({
  tasks,
  title,
  icon,
  emptyText,
  onOpenTask,
  headerExtra,
}: {
  tasks: Task[];
  title: string;
  icon: string;
  emptyText: string;
  onOpenTask: (id: string) => void;
  // "전체 업무목록" 제목 옆에 업무상황판을 아주 작게 붙이기 위한 슬롯입니다(요청: "업무상황판을
  // 오른쪽 전체 업무목록 제목 옆에 아주 작게 배치"). 다른 목록(내 업무목록)은 그냥 비워둡니다.
  headerExtra?: React.ReactNode;
}) {
  return (
    <div className="glass flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2 text-[13px] font-bold text-blue-600">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">
            {icon} {title}
          </span>
          {headerExtra}
        </span>
        <span className="shrink-0 rounded-full bg-black/5 px-1.5 py-0.5 text-[11px] text-slate-600">{tasks.length}건</span>
      </div>
      {tasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs opacity-40">{emptyText}</div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {tasks.map((task) => {
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
