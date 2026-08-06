import type { Task, TaskRecurrence } from "./types";
import { genCaseId } from "./caseId";

// 완료된 업무의 마감일(또는 완료 시각)을 기준으로 다음 회차의 마감일을 계산합니다.
// - 매일: +1일
// - 매주: 지정한 요일(weekday) 중 다음으로 오는 날짜
// - 매월: 지정한 날짜(day_of_month), 다음 달에 그 날짜가 없으면(예: 31일→2월) 그 달의
//   마지막 날로 자동 보정
function computeNextOccurrence(recurrence: NonNullable<TaskRecurrence>, baseDueAt: string | null): string {
  const base = baseDueAt ? new Date(baseDueAt) : new Date();
  const hh = base.getHours();
  const mm = base.getMinutes();

  if (recurrence.freq === "daily") {
    const next = new Date(base);
    next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  if (recurrence.freq === "weekly") {
    const targetDay = recurrence.weekday ?? base.getDay();
    const next = new Date(base);
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() !== targetDay);
    next.setHours(hh, mm, 0, 0);
    return next.toISOString();
  }

  // monthly
  const targetDom = recurrence.day_of_month ?? base.getDate();
  const nextMonthFirst = new Date(base.getFullYear(), base.getMonth() + 1, 1, hh, mm, 0);
  const lastDayOfNextMonth = new Date(nextMonthFirst.getFullYear(), nextMonthFirst.getMonth() + 1, 0).getDate();
  nextMonthFirst.setDate(Math.min(targetDom, lastDayOfNextMonth));
  return nextMonthFirst.toISOString();
}

// 반복 업무가 "완료"로 바뀔 때 다음 회차를 안전하게 만듭니다. 칸반 드래그(WorkBoardClient)와
// 업무 상세패널(TaskDetailPanel) 두 곳 모두에서 완료 처리가 일어날 수 있어서 공용 함수로
// 뺐습니다 - 예전에는 칸반 쪽에만 이 로직이 있어서 상세패널에서 완료 처리하면 반복이 조용히
// 끊겼습니다. DB의 고유 제약(recurrence_group_id + due_at, schema.sql 참고) 덕분에, 두 사람이
// (또는 한 사람이 두 곳에서) 거의 동시에 같은 업무를 완료 처리해도 다음 회차가 중복 생성되지
// 않고 한 번만 만들어집니다 - 나중에 도착한 쪽은 고유 제약 위반(23505)을 조용히 무시합니다.
export async function renewRecurringTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  task: Task
): Promise<Task | null> {
  if (!task.recurrence) return null;
  const nextDueAt = computeNextOccurrence(task.recurrence, task.due_at ?? task.completed_at);
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      case_id: genCaseId("TSK"),
      title: task.title,
      description: task.description,
      status: "예정",
      priority: task.priority,
      department: task.department,
      owner_email: task.owner_email,
      assignee_emails: task.assignee_emails,
      due_at: nextDueAt,
      position: Date.now(),
      origin_mode: task.origin_mode,
      recurrence: task.recurrence,
      recurrence_group_id: task.recurrence_group_id,
    })
    .select()
    .single();
  if (error) {
    if (error.code !== "23505") {
      console.error("반복 업무 다음 회차 생성 실패:", error.message);
    }
    return null;
  }
  return data as Task;
}

export function recurrenceLabel(r: NonNullable<TaskRecurrence>): string {
  if (r.freq === "daily") return "매일 반복";
  if (r.freq === "weekly") {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `매주 ${days[r.weekday ?? new Date().getDay()]}요일 반복`;
  }
  return `매월 ${r.day_of_month ?? 1}일 반복`;
}
