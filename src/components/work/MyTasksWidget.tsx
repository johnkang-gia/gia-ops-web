"use client";

import type { Task } from "@/lib/types";
import { isMyTask } from "@/lib/myTask";
import TaskListPane from "./TaskListPane";

// "내 업무목록" - 내가 담당자로 태그된 업무만(완료 제외) 마감 임박 순으로 모아 보여줍니다.
// 판정 기준을 "태그되었는가" 하나로 통일했습니다(요청: "태그를 기준으로 내 업무목록이 뜨도록
// 하고... 진행대기와 내 업무목록은 내가 태그된 업무만 뜨도록"). 예전에는 여기서 등록자
// 여부(owner_email)와 [전체] 모드 여부를 따로 확인했는데, 이제 등록 시점에 등록자 자신이 항상
// 태그되고([나]/[공유] 모드) [전체] 모드는 부서원 전원이 태그되므로(QuickTaskWidget), 태그
// 하나만 보면 세 경우가 전부 자연스럽게 포함됩니다 - 업무 흐름판(진행대기/진행중/완료)도
// 똑같은 기준을 씁니다.
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
    .filter((t) => isMyTask(t, currentUserEmail) && t.status !== "완료")
    .sort((a, b) => {
      const at = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bt = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return at - bt;
    });

  return <TaskListPane tasks={mine} title="내 업무목록" icon="🙋" emptyText="배정된 업무가 없습니다" onOpenTask={onOpenTask} />;
}
