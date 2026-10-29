import { todayKst } from "@/lib/kst";

/**
 * **다른 달로 발행하기 전에 한 번 묻습니다.**
 *
 * 청구서의 «몇 월분»은 재무 화면이 보고 있는 달입니다. 그 달은 쿠키에 남아서, 다음 달을 한 번 열어 본 뒤
 * 다른 화면에서 발행하면 이번 달 청구서가 다음 달분으로 찍혔습니다(10월 28일 발행분 59장이 11월분으로 찍혀
 * 11월 칸이 잠김). 미리 다음 달 것을 내는 일도 있어서 막지는 않고, 다른 달일 때만 묻습니다.
 */
export function confirmIssueMonth(month: string | null | undefined): boolean {
  if (!month) return true;
  const now = todayKst().slice(0, 7);
  if (month === now) return true;
  const label = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
  if (typeof window === "undefined") return true;
  return window.confirm(
    `${label(month)}분 청구서로 발행합니다.\n오늘은 ${label(now)}입니다 — 화면의 달이 ${label(month)}로 되어 있습니다.\n\n${label(month)}분이 맞으면 [확인], 아니면 [취소]를 누르고 화면 위의 달을 바꿔 주세요.`,
  );
}
