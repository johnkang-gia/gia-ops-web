// 업무 보고서 / 회의 보고서에서 공통으로 쓰는 일간·주간·월간 기간 계산 헬퍼입니다.
// "언제부터 언제까지"를 이 파일 한 곳에서만 계산해서, 화면(WorkReportClient/
// MeetingReportClient)과 PDF 라우트가 항상 똑같은 기준으로 기간을 자릅니다.

export type ReportPeriodType = "day" | "week" | "month";

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0=일
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
}

export type ReportRange = { start: string; end: string; label: string };

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function getReportRange(type: ReportPeriodType, anchor: Date): ReportRange {
  if (type === "day") {
    const start = toDateStr(anchor);
    return { start, end: start, label: `${start} (${WEEKDAY_KO[anchor.getDay()]})` };
  }
  if (type === "week") {
    const monday = startOfWeekMonday(anchor);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { start: toDateStr(monday), end: toDateStr(sunday), label: `${toDateStr(monday)} ~ ${toDateStr(sunday)}` };
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start: toDateStr(start), end: toDateStr(end), label: `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월` };
}

export function shiftAnchor(type: ReportPeriodType, anchor: Date, dir: 1 | -1): Date {
  const d = new Date(anchor);
  if (type === "day") d.setDate(d.getDate() + dir);
  else if (type === "week") d.setDate(d.getDate() + dir * 7);
  else d.setMonth(d.getMonth() + dir);
  return d;
}

export const PERIOD_TYPE_LABEL: Record<ReportPeriodType, string> = {
  day: "일간",
  week: "주간",
  month: "월간",
};
