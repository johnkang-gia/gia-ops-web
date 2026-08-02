// 마감일을 "오늘 마감" / "내일 마감" / "3일 후 마감" 같은 짧은 문구로 바꿔줍니다. TaskCard와
// MyTasksWidget 등 여러 곳에서 같은 표기를 쓰기 위해 공용 유틸로 분리했습니다.
export function deadlineLabel(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const now = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return `${-diffDays}일 지남`;
  if (diffDays === 0) return "오늘 마감";
  if (diffDays === 1) return "내일 마감";
  if (diffDays <= 7) return `${diffDays}일 후 마감`;
  return due.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) + " 마감";
}
