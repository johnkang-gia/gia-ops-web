"use client";

import type { Task } from "@/lib/types";
import { STATUS_LABEL, STATUS_COLOR } from "./statusConfig";
import { deadlineLabel } from "@/lib/deadlineLabel";

// 우측 상단에 "내 업무목록" 위젯 - 내가 등록했거나(등록자 본인) 나를 태그(담당자로 지정)한
// 업무만(완료 제외) 마감 임박 순으로 모아 보여줘서, 굳이 칸반 전체를 훑지 않아도 내가 지금
// 처리해야 할 일이 한눈에 들어오게 했습니다. [나] 모드는 등록자=나·담당자=나뿐이라 자연히
// 나에게만 보이고, [공유(태그)] 모드는 등록자인 나와 내가 태그한 사람 모두의 목록에 함께
// 뜨고, [전체] 모드는 부서원 전원이 담당자로 들어가 있어 모두의 목록에 뜹니다(요청: "업무등록
// 나로 할경우 다른사람에게는 안보이고 나에게만... 태그를 하면 내 업무목록과 태그한사람
// 둘에게... 내 업무목록은 내가등록하거나 나를 태그한 사람의 업무만 보이도록"). 서버 쪽 RLS도
// 같은 기준으로 애초에 조회 자체를 막아두었으니(나/공유 모드는 관계자 외에는 DB에서부터
// 안 내려옵니다), 여기 필터는 그 안에서 "지금 나와 상관있는 것"만 한 번 더 추려내는 역할입니다.
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
    .filter(
      (t) =>
        (t.owner_email === currentUserEmail || t.assignee_emails?.includes(currentUserEmail)) &&
        t.status !== "완료"
    )
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
