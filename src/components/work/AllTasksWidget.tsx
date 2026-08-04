"use client";

import type { Task } from "@/lib/types";
import TaskListPane from "./TaskListPane";

// "전체 업무목록" - "내 업무목록"의 짝으로, 필터 없이 지금 화면에 올라온(=서버 RLS로 내가 볼
// 권한이 있는) 업무를 전부(완료 제외) 마감 임박 순으로 보여줍니다(요청: "전체목록은 올라오는
// 모든 업무목록을 보여주고"). [나]/[공유] 모드로 등록된, 나와 관계없는 업무는 애초에 서버가
// 이 화면으로 내려주지 않으니(요청 반영: 업무 공개범위 RLS), 여기 보이는 "전체"는 정확히는
// "내가 볼 수 있는 전체"입니다. 부서 필터는 걸지 않습니다 - 칸반은 부서 탭으로 이미 나뉘어
// 있지만, 이 목록은 내 업무목록과 마찬가지로 부서에 상관없이 마감이 임박한 순서를 보는
// 용도입니다.
export default function AllTasksWidget({
  tasks,
  onOpenTask,
}: {
  tasks: Task[];
  onOpenTask: (id: string) => void;
}) {
  const all = tasks
    .filter((t) => t.status !== "완료")
    .sort((a, b) => {
      const at = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bt = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return at - bt;
    });

  return <TaskListPane tasks={all} title="전체 업무목록" icon="🗂️" emptyText="등록된 업무가 없습니다" onOpenTask={onOpenTask} />;
}
