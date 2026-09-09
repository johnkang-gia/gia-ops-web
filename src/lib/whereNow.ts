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

/**
 * **제 교실에서 하는 과목.**
 *
 * Novel Studies 와 WSC 는 특별실로 옮기지 않고 **각 반 교실에서** 합니다. 시간표 칸에
 * 장소를 적지 않는 것이 당연하고, 그래서 여태 「장소가 적혀 있지 않습니다」로 빠졌습니다.
 *
 * 「적혀 있지 않다」와 「제 교실이다」는 다른 말입니다. 앞의 것은 사람이 시간표를 고쳐야
 * 하는 상태이고, 뒤의 것은 고칠 게 없는 정상입니다. 둘이 같아 보이면 아무도 안 고칩니다.
 */
const HOMEROOM_SUBJECTS = /novel\s*stud|wsc\b|world\s*scholar/i;

/** 이 과목은 제 교실에서 하는가. */
export function isHomeroomSubject(subject: string | null | undefined): boolean {
  return HOMEROOM_SUBJECTS.test(String(subject ?? ""));
}

/** 'HH:MM:SS' 를 그대로 비교합니다 - 같은 자릿수 문자열이라 숫자로 바꿀 필요가 없습니다. */
function within(now: string, start: string, end: string): boolean {
  const cut = (t: string) => t.slice(0, 8).padEnd(8, "0");
  return cut(start) <= cut(now) && cut(now) < cut(end);
}

export type NowPlace =
  | {
      known: true;
      place: string;
      subject: string;
      periodLabel: string;
      fromTimetableRoom: boolean;
      /** 제 교실에서 하는 과목이라 반 교실로 답한 경우. 짐작이 아니라 아는 것입니다. */
      homeroomSubject?: boolean;
    }
  | {
      known: false;
      why: string;
      /**
       * 화면에 **그대로 적을** 짧은 말.
       *
       * 예전에는 이유를 마우스 올려야 보이는 곳(title)에만 뒀고, 화면에는 「📍 —」만
       * 떴습니다. 그래서 「주말이라 안 뜨는 것」과 「교실이 안 적혀서 안 뜨는 것」이
       * 똑같아 보였습니다 - 앞의 것은 정상이고 뒤의 것은 고쳐야 하는 것인데, 구별이
       * 안 되니 아무도 고치지 않았습니다.
       */
      short: string;
    };

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
  if (!classId) return { known: false, why: "반 배정이 없어 시간표를 볼 수 없습니다", short: "반 없음" };

  const at = args.now ?? new Date();
  const weekday = args.now ? kstWeekdayOf(args.now) : kstWeekday();
  if (weekday === 0 || weekday === 6) return { known: false, why: "주말입니다", short: "주말" };

  const nowTime = kstTime(at);
  const mine = periods.filter((p) => p.department === department);
  const pool = mine.length > 0 ? mine : periods;
  const period = pool.find((p) => within(nowTime, p.start_time, p.end_time));
  if (!period) return { known: false, why: "지금은 수업 시간이 아닙니다", short: "수업시간 아님" };

  const cell = timetable.find((t) => t.class_id === classId && t.weekday === weekday && t.period_id === period.id);
  const periodLabel = period.label || `${period.period_no}교시`;
  if (!cell) return { known: false, why: `${periodLabel} 시간표가 없습니다`, short: `${periodLabel} 시간표 없음` };

  const room = (cell.room ?? "").trim();
  if (room) return { known: true, place: room, subject: cell.subject_name, periodLabel, fromTimetableRoom: true };

  const home = (classRoom ?? "").trim();

  // **제 교실에서 하는 과목이 먼저입니다.**
  //
  // Novel Studies·WSC 는 특별실로 옮기지 않습니다. 과목 이름으로 장소를 짐작하는 규칙보다
  // 앞에 둡니다 - 나중에 누가 「studies」 같은 넓은 규칙을 넣으면 이 아이들이 엉뚱한 방으로
  // 끌려가는데, 그건 화면에 오류가 아니라 «그럴듯한 장소»로 보입니다.
  if (isHomeroomSubject(cell.subject_name) && home) {
    return { known: true, place: home, subject: cell.subject_name, periodLabel, fromTimetableRoom: false, homeroomSubject: true };
  }

  const guessed = placeOfSubject(cell.subject_name);
  if (guessed) return { known: true, place: guessed, subject: cell.subject_name, periodLabel, fromTimetableRoom: false };

  if (home) return { known: true, place: home, subject: cell.subject_name, periodLabel, fromTimetableRoom: false };

  // 여기까지 왔으면 **반 교실이 명부에 안 적혀 있는 것**입니다. 사람이 고칠 수 있는 일이라
  // 그렇게 말해줍니다 - 「장소가 없다」로 뭉뚱그리면 무엇을 고쳐야 하는지 알 수 없습니다.
  return {
    known: false,
    why: `${periodLabel} ${cell.subject_name} - 시간표에도 반 명부에도 교실이 적혀 있지 않습니다`,
    short: "교실 미지정",
  };
}

/** 주어진 시각의 한국 요일. 0=일 … 6=토. */
function kstWeekdayOf(at: Date): number {
  const ymd = at.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  return new Date(`${ymd}T12:00:00+09:00`).getDay();
}
