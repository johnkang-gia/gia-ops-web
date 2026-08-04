"use client";

import type { Task } from "@/lib/types";
import TaskListPane from "./TaskListPane";

// "내 업무목록" - 내가 등록했거나(등록자 본인) 나를 태그(담당자로 지정)했거나 [전체] 모드로
// 등록된(부서원 전원 대상) 업무만(완료 제외) 마감 임박 순으로 모아 보여줘서, 굳이 칸반이나
// 옆의 "전체 업무목록"을 다 훑지 않아도 내가 지금 처리해야 할 일이 한눈에 들어오게 했습니다.
// [나] 모드는 등록자=나·담당자=나뿐이라 자연히 나에게만 뜨고, [공유(태그)] 모드는 등록자인
// 나와 내가 태그한 사람 모두의 목록에 함께 뜨고, [전체] 모드는 부서원 전원 몫이라 항상
// 뜹니다(요청: "왼쪽 내 업무목록은 그중에서 내가 태그되거나 전체로 표시되거나 내가등록한
// 업무를 보여주도록 해줘"). 서버 쪽 RLS도 같은 기준으로 애초에 조회 자체를 막아두었으니
// (나/공유 모드는 관계자 외에는 DB에서부터 안 내려옵니다), 여기 필터는 그 안에서 "지금 나와
// 상관있는 것"만 한 번 더 추려내는 역할입니다.
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
        (t.owner_email === currentUserEmail || t.assignee_emails?.includes(currentUserEmail) || t.origin_mode === "전체") &&
        t.status !== "완료"
    )
    .sort((a, b) => {
      const at = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bt = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return at - bt;
    });

  return <TaskListPane tasks={mine} title="내 업무목록" icon="🙋" emptyText="배정된 업무가 없습니다" onOpenTask={onOpenTask} />;
}
