// 리포트 작성 주기.
//
// 담당자: "위클리가 아니라 2주 단위인 바이위클리로 작성하기로 했어. 근데 이 부분은 그냥
//          위클리로 놔두고 체크하는 것만 2주에 한 번 체크하도록 만들어줘도 되고."
//
// 뒤쪽을 택했습니다. **화면 이름은 '위클리 리포트' 그대로 두고, "이번 기간에 이미 썼는가"를
// 판정하는 자만 2주로 바꿉니다.** 이름까지 바꾸면 메뉴·제목·안내문·인쇄본까지 손대야 하고,
// 되돌릴 때도 그만큼 듭니다. 선생님이 실제로 겪는 변화(2주에 한 번 쓴다)는 이것으로 충분합니다.
//
// **왜 '월요일부터 14일'인가:** 주 단위 판정은 달력의 주가 기준이어야 사람이 헤아릴 수
// 있습니다. 아래 고정 기준 월요일에서 14일씩 끊습니다 - 어느 날 계산해도 같은 답이 나오고,
// 서버·브라우저 어디서 돌려도 같습니다.
const PERIOD_DAYS = 14;

/**
 * 격주 주기의 기준이 되는 월요일.
 *
 * 이 날이 1주기의 첫날입니다. 학교 사정으로 격주를 한 주 밀어야 하면 **이 날짜만**
 * 7일 옮기면 전체가 따라 옵니다.
 */
const ANCHOR_MONDAY = "2026-03-02"; // 26-27학년도 1학기 첫 월요일

/** 한국 날짜(YYYY-MM-DD). UTC로 찍으면 오전 9시 이전에 하루가 밀립니다. */
function kstDateStr(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** YYYY-MM-DD 를 (시차 영향을 받지 않는) 정오 UTC 시각으로. 날짜 계산 전용입니다. */
function noonUtc(ymd: string): number {
  return Date.parse(`${ymd}T12:00:00Z`);
}

const DAY_MS = 86400000;

/**
 * 오늘이 속한 **작성 기간**(격주 2주)의 시작·끝 날짜.
 *
 * 이 범위 안에 이미 쓴 리포트가 있으면 그것을 이어서 고치고, 없으면 새로 만듭니다.
 */
export function getPeriodRange(base: Date = new Date()): { start: string; end: string } {
  const today = kstDateStr(base);
  const diffDays = Math.floor((noonUtc(today) - noonUtc(ANCHOR_MONDAY)) / DAY_MS);
  // 기준일 이전(예: 학기 시작 전에 미리 쓰는 경우)에도 음수 쪽으로 같은 규칙이 이어지도록
  // floor를 씁니다. -1일은 -1주기가 아니라 직전 주기의 마지막 날이어야 합니다.
  const periodIndex = Math.floor(diffDays / PERIOD_DAYS);
  const startMs = noonUtc(ANCHOR_MONDAY) + periodIndex * PERIOD_DAYS * DAY_MS;
  const endMs = startMs + (PERIOD_DAYS - 1) * DAY_MS;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: fmt(startMs), end: fmt(endMs) };
}

/**
 * 예전 이름. 부르는 곳이 여럿이라 남겨둡니다 - **이제 2주를 돌려줍니다.**
 *
 * @deprecated 새 코드는 getPeriodRange를 쓰세요.
 */
export const getWeekRange = getPeriodRange;

/** "3월 2일 ~ 3월 15일"처럼 사람이 읽는 기간 표시. */
export function periodLabel(base: Date = new Date()): string {
  const { start, end } = getPeriodRange(base);
  const f = (ymd: string) =>
    new Date(`${ymd}T12:00:00Z`).toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "UTC" });
  return `${f(start)} ~ ${f(end)}`;
}
