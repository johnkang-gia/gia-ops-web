import type { TaskRecurrence } from "./types";

// 완료된 업무의 마감일(또는 완료 시각)을 기준으로 다음 회차의 마감일을 계산합니다.
// - 매일: +1일
// - 매주: 지정한 요일(weekday) 중 다음으로 오는 날짜
// - 매월: 지정한 날짜(day_of_month), 다음 달에 그 날짜가 없으면(예: 31일→2월) 그 달의
//   마지막 날로 자동 보정
export function computeNextOccurrence(recurrence: NonNullable<TaskRecurrence>, baseDueAt: string | null): string {
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

export function recurrenceLabel(r: NonNullable<TaskRecurrence>): string {
  if (r.freq === "daily") return "매일 반복";
  if (r.freq === "weekly") {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `매주 ${days[r.weekday ?? new Date().getDay()]}요일 반복`;
  }
  return `매월 ${r.day_of_month ?? 1}일 반복`;
}
