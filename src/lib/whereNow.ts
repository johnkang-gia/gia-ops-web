/**
 * **지금 이 아이가 어디 있는가**를 시간표로 답하는 한 곳입니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 *
 * 학부모 전화를 받거나 아이를 찾아가야 할 때, 필요한 것은 반 이름이 아니라 **장소**입니다.
 * 반 이름만 보고 교실에 갔는데 그 시간이 체육이면 아이는 체육관에 있습니다. 행정실 직원이
 * 교실→체육관→교실을 왕복하는 일이 실제로 생깁니다.
 *
 * ── 무엇을 믿는가 ────────────────────────────────────────────────────
 *
 * 순서가 중요합니다.
 *
 *   1. 시간표 칸에 적힌 장소(`wr_timetable.room`) - 사람이 직접 적은 것이라 가장 정확합니다
 *   2. 과목 이름에서 읽히는 장소 - 「체육」이면 체육관입니다
 *   3. 그 반의 교실(`wr_classes.room`) - 위 둘이 없으면 제 교실에 있습니다
 *
 * **모르면 모른다고 합니다.** 시간표가 없는 반, 수업 시간이 아닌 시각에는 장소를 지어내지
 * 않고 이유를 돌려줍니다 - 「지금은 수업 시간이 아닙니다」와 「체육관」은 전혀 다른 말인데,
 * 둘 다 빈칸으로 보이면 보는 사람은 앞의 것도 뒤의 것으로 읽습니다.
 */

import { kstTime, kstWeekday } from "@/lib/kst";

export type PeriodRow = {
  id: string;
  department: string;
  period_no: number;
  label: string | null;
  start_time: string; // 'HH:MM:SS'
  end_time: string;
};

export type TimetableRow = {
  class_id: string;
  weekday: number; // 1=월 … 5=금
  period_id: string;
  subject_name: string;
  room: string | null;
};

/**
 * 과목 이름에서 읽어내는 장소.
 *
 * 짧게 둡니다. 여기 목록이 길어질수록 「과학인데 왜 실험실이라고 나오지」 같은 헛일이
 * 늘어납니다 - 정확한 장소는 시간표 칸에 적는 것이 맞고, 이건 **적혀 있지 않을 때의
 * 대비책**입니다.
 */
const SUBJECT_PLACES: { match: RegExp; place: string }[] = [
  { match: /체육|physical\s*ed|^\s*p\.?\s*e\.?\b|sports|gym/i, place: "GYM" },
  { match: /컴퓨터|코딩|정보|comput|coding|ict/i, place: "COM" },
  { match: /수영|swim/i, place: "POOL" },
  { match: /도서|독서|librar/i, place: "LIB" },
  { match: /음악|music|악기|합주/i, place: "MUS" },
  { match: /미술|art\b|공예/i, place: "ART" },
  { match: /과학실험|실험실|lab\b/i, place: "LAB" },
];

/** 과목 이름만 보고 장소를 추측합니다. 못 읽으면 null - 지어내지 않습니다. */
export function placeOfSubject(subject: string | null | undefined): string | null {
  const s = String(subject ?? "").trim();
  if (!s) return null;
  for (const r of SUBJECT_PLACES) if (r.match.test(s)) return r.place;
  return null;
}

/** 'HH:MM:SS' 를 그대로 비교합니다 - 같은 자릿수 문자열이라 숫자로 바꿀 필요가 없습니다. */
function within(now: string, start: string, end: string): boolean {
  const cut = (t: string) => t.slice(0, 8).padEnd(8, "0");
  return cut(start) <= cut(now) && cut(now) < cut(end);
}

export type NowPlace =
  | { known: true; place: string; subject: string; periodLabel: string; fromTimetableRoom: boolean }
  | { known: false; why: string };

/**
 * 지금 이 반이 있는 곳.
 *
 * `now` 를 넘길 수 있게 열어둔 이유는 시험 때문입니다 - 시각에 따라 답이 달라지는 함수는
 * 실제 시계로는 확인할 수 없습니다.
 */
export function whereNow(args: {
  classId: string | null;
  /** 부서를 모르면(학년이 안 읽히는 줄) 교시를 전부 놓고 봅니다 - 그래도 대개 겹치지 않습니다. */
  department: string | null;
  classRoom: string | null;
  periods: PeriodRow[];
  timetable: TimetableRow[];
  now?: Date;
}): NowPlace {
  const { classId, department, classRoom, periods, timetable } = args;
  if (!classId) return { known: false, why: "반 배정이 없어 시간표를 볼 수 없습니다" };

  const at = args.now ?? new Date();
  const weekday = args.now ? kstWeekdayOf(args.now) : kstWeekday();
  if (weekday === 0 || weekday === 6) return { known: false, why: "주말입니다" };

  const nowTime = kstTime(at);
  const mine = periods.filter((p) => p.department === department);
  const pool = mine.length > 0 ? mine : periods;
  const period = pool.find((p) => within(nowTime, p.start_time, p.end_time));
  if (!period) return { known: false, why: "지금은 수업 시간이 아닙니다" };

  const cell = timetable.find((t) => t.class_id === classId && t.weekday === weekday && t.period_id === period.id);
  const periodLabel = period.label || `${period.period_no}교시`;
  if (!cell) return { known: false, why: `${periodLabel} 시간표가 없습니다` };

  const room = (cell.room ?? "").trim();
  if (room) return { known: true, place: room, subject: cell.subject_name, periodLabel, fromTimetableRoom: true };

  const guessed = placeOfSubject(cell.subject_name);
  if (guessed) return { known: true, place: guessed, subject: cell.subject_name, periodLabel, fromTimetableRoom: false };

  const home = (classRoom ?? "").trim();
  if (home) return { known: true, place: home, subject: cell.subject_name, periodLabel, fromTimetableRoom: false };

  return { known: false, why: `${periodLabel} ${cell.subject_name} - 장소가 적혀 있지 않습니다` };
}

/** 주어진 시각의 한국 요일. 0=일 … 6=토. */
function kstWeekdayOf(at: Date): number {
  const ymd = at.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  return new Date(`${ymd}T12:00:00+09:00`).getDay();
}
