import type { Task } from "@/lib/types";

// "이 업무가 내 업무인가"의 단일 기준입니다(요청: "태그를 기준으로 내 업무목록이 뜨도록 하고...
// 진행대기와 내 업무목록은 내가 태그된 업무만 뜨도록"). 내 업무목록 위젯과 업무 흐름판
// (진행대기/진행중/완료)이 같은 함수를 쓰게 해서 두 곳의 기준이 서로 어긋나지 않게 했습니다.
//
// 등록 시점 규칙(QuickTaskWidget)과 짝을 이룹니다:
// - [나]   → 나 혼자 태그
// - [공유] → 고른 사람 + 등록자 본인 태그
// - [전체] → 부서원 전원 태그
// 즉 등록자는 어떤 모드로 등록하든 항상 태그되므로, 여기서 owner_email이나 origin_mode를
// 따로 확인할 필요가 없습니다.
//
// origin_mode === "전체"를 함께 보는 이유는 과거 데이터 때문입니다 - 이 규칙이 생기기 전에
// 등록된 [전체] 업무 중에는 부서원이 나중에 합류해서 assignee_emails에 빠져 있는 경우가
// 있어서, 그런 업무가 갑자기 목록에서 사라지지 않도록 남겨둡니다.
export function isMyTask(task: Task, email: string): boolean {
  return task.assignee_emails?.includes(email) || task.origin_mode === "전체";
}
