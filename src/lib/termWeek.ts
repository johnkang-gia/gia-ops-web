/**
 * **학기 시작 후 몇 주차, 무슨 요일** — 해가 바뀌어도 같은 자리에 오도록.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 되풀이되는 학사일정을 **날짜**로 적어두면 해마다 어긋납니다. 「12월 18일 크리스마스
 * 콘서트」는 올해는 학기 15주차 금요일인데, 내년에 학기 시작일이 한 주 밀리면 14주차가
 * 됩니다. 준비 기간이 한 주 짧아진 것인데 달력에는 그 사실이 안 보입니다 - 날짜는 그대로
 * 있으니 아무도 이상하다고 느끼지 않고, 준비가 모자란 채로 그날이 옵니다.
 *
 * 학교 일은 **학기 안에서의 자리**로 굴러갑니다. 「학기 3주차 월요일에 준비 시작」이라고
 * 적어두면 시작일이 언제로 바뀌든 같은 흐름이 나옵니다.
 *
 * ── 주는 월요일에 시작합니다 ────────────────────────────────────────────────
 *
 * 학교의 한 주는 월요일부터입니다. 그래서 **1주차는 학기 시작일이 든 그 주**이고, 시작일이
 * 수요일이면 그 주 월·화도 1주차입니다. 일요일 기준으로 세면 금요일 개학의 다음 월요일이
 * 2주차가 되어, 사람이 「첫 주」라고 부르는 주와 화면이 어긋납니다.
 *
 * ── 요일을 안 적으면 월요일입니다 ───────────────────────────────────────────
 *
 * 준비 시작은 대개 그 주 첫 근무일에 겁니다. 안 적었다고 날짜를 비워두면 그 일정은 달력에
 * 안 뜨고, 안 뜨는 일은 아무도 못 합니다. 월요일로 두면 사람이 보고 옮길 수 있습니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

export const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 학기의 갈래. 정규와 캠프는 길이도 리듬도 달라서 주차를 섞어 쓸 수 없습니다. */
export type TermKind = "정규" | "캠프";
export const TERM_KINDS: TermKind[] = ["정규", "캠프"];

function parse(key: string): Date | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec((key ?? "").slice(0, 10));
  if (!hit) return null;
  return new Date(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3]));
}

function key(d: Date): string {
  // 여기 들어오는 Date 는 **「지금」이 아니라 적혀 있는 날짜**입니다. 위의 parse() 가
  // `new Date(년, 월, 일)` 로 만든 값이라 시·분이 0이고, 그것을 다시 년·월·일로 꺼낼
  // 뿐입니다. 오전 9시 이전 문제는 「지금」을 그 기계 시각으로 굳힐 때 생깁니다.
  // kst-ok: 「지금」이 아니라 넘겨받은 날짜를 되돌려 적는 자리입니다.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 그 날이 든 주의 **월요일**. 주의 경계를 한 곳에서만 정합니다. */
export function mondayOf(date: string): string | null {
  const d = parse(date);
  if (!d) return null;
  // getDay(): 0=일 … 6=토. 일요일은 **앞 주**의 끝이므로 6일을 뺍니다.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return key(d);
}

export type TermSpot = {
  /** 학기 시작 주가 1주차. 시작일보다 앞이면 0 이하가 됩니다. */
  week: number;
  /** 0=일 … 6=토. */
  dow: number;
};

/**
 * 그 날이 **학기 몇 주차 무슨 요일**인가.
 *
 * 등록 화면이 「지금 고른 날짜는 여기입니다」라고 알려줄 때 씁니다. 사람이 날짜로 생각한
 * 것을 주차로 옮겨 적어주지 않으면, 주차로 바꾸는 계산을 머릿속으로 해야 합니다 - 그러면
 * 대개 안 바꾸고 날짜 그대로 둡니다.
 */
export function weekOfTerm(termStart: string, date: string): TermSpot | null {
  const m0 = mondayOf(termStart);
  const m1 = mondayOf(date);
  const d = parse(date);
  if (!m0 || !m1 || !d) return null;
  const a = parse(m0)!;
  const b = parse(m1)!;
  // 하루를 밀리초로 나누면 서머타임에서 어긋납니다. 두 값 모두 월요일 00:00 이라 안전하지만,
  // 반올림해 둡니다 - 시간대 설정이 바뀌어도 주 수는 정수로 나와야 합니다.
  const weeks = Math.round((b.getTime() - a.getTime()) / (7 * 86_400_000));
  return { week: weeks + 1, dow: d.getDay() };
}

/**
 * **학기 N주차 무슨 요일**은 실제로 며칠인가.
 *
 * `dow` 를 안 넘기면 그 주 월요일입니다. 일요일(0)은 그 주의 **마지막 날**로 봅니다 -
 * 월요일에서 6일 뒤입니다. 그래야 「3주차 일요일」이 3주차 안에 남습니다.
 */
export function dateOfTermWeek(termStart: string, week: number, dow: number | null | undefined): string | null {
  const m0 = mondayOf(termStart);
  if (!m0 || !Number.isFinite(week)) return null;
  const d = parse(m0)!;
  d.setDate(d.getDate() + (Math.round(week) - 1) * 7 + ((dow == null ? 1 : Math.round(dow)) + 6) % 7);
  return key(d);
}

/** 「학기 3주차 목요일」. 화면 여러 곳이 같은 문장을 쓰도록 여기 둡니다. */
export function describeTermWeek(week: number, dow: number | null | undefined, kind?: TermKind | null): string {
  const w = week === 1 ? "첫 주" : `${week}주차`;
  const day = dow == null ? "월요일" : `${DOW_KO[((dow % 7) + 7) % 7]}요일`;
  return `${kind ? `${kind} 학기 ` : "학기 "}${w} ${day}`;
}

/**
 * 지금 잡혀 있는 날짜가 학기 어디쯤인지 한 줄로.
 *
 * 등록 화면이 이 문장을 그대로 보여줍니다. **학기 시작일을 모르면 빈 글자**를 돌려줍니다 -
 * 모르는 채로 「1주차」라고 적으면 그 말이 사실처럼 굳습니다.
 */
export function spotLabel(termStart: string | null | undefined, date: string | null | undefined, kind?: TermKind | null): string {
  if (!termStart || !date) return "";
  const spot = weekOfTerm(termStart, date);
  if (!spot) return "";
  if (spot.week < 1) {
    const before = 1 - spot.week;
    return `학기 시작 ${before}주 전 ${DOW_KO[spot.dow]}요일`;
  }
  return describeTermWeek(spot.week, spot.dow, kind);
}
