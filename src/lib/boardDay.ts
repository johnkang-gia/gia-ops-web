

/**
 * **운영 하루의 기준 시각** — 아침 8시.
 *
 * 중앙 대시보드는 사무실 큰 모니터에 하루 종일 켜져 있습니다. 날짜가 바뀌어도 아무도
 * 새로고침하지 않으니, 어제 픽업이 오늘 화면에 그대로 남아 있었습니다. 오류가 아니라
 * 「어제 자료」라서 보는 사람은 오늘 것인 줄 압니다.
 *
 * 자정을 기준으로 삼지 않은 이유: 새벽에 화면을 보는 사람은 아직 **어제를 마무리하는
 * 중**입니다. 하루가 실제로 바뀌는 것은 아이들이 오는 때입니다.
 */
export const BOARD_DAY_START_HOUR = 8;

/** 지금이 속한 「운영 하루」. 아침 8시 전이면 어제입니다. */
export function boardDayKst(now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(now),
  );
  // 8시 전이면 어제. 한국 시간으로 24시간 앞선 순간의 날짜를 씁니다 -
  // 날짜 문자열을 직접 빼면 월말·연말에 어긋납니다.
  const at = hour >= BOARD_DAY_START_HOUR ? now : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(at);
}
