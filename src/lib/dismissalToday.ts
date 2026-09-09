import { pickByStudent, weekStartOf } from "./dismissalWeek";

/**
 * **오늘(또는 그날) 이 아이는 무엇을 타고 가는가** — 읽는 자리 전부가 여기를 지납니다.
 *
 * ── 왜 한 곳에 모았나 ────────────────────────────────────────────────
 *
 * 하원수단을 읽는 화면이 아홉 곳입니다. 운영 대시보드, 하원 체크표, 담임 픽업체크,
 * 학생 프로필, 5분 전 알람, 크론 …
 *
 * 「매주」와 「그 주만」이 겹치면서 **어느 쪽이 답인가**를 정해야 하는 판단이 생겼는데,
 * 그 판단을 아홉 번 다시 쓰면 아홉 번 다 같기를 바라야 합니다. 실제로는 몇 곳이 어긋나고,
 * 어긋난 화면은 오류를 내지 않습니다 - 그냥 다른 아이 이름을 보여줍니다. 그러면 사람은
 * 어느 화면도 안 믿게 됩니다.
 *
 * 규칙 자체는 `dismissalWeek.ts` 에 있고(값 → 값), 여기는 그 규칙으로 표를 읽는 자리입니다.
 */

/** 읽어오는 칸. 자리마다 다르게 적으면 어느 화면에만 note 가 빠지는 식이 됩니다. */
export const DISMISSAL_SELECT = "student_id, weekday, kind, label, depart_time, note, week_start";

export type DismissalRow = {
  student_id: string;
  weekday: number;
  kind: string;
  label: string | null;
  depart_time: string | null;
  note: string | null;
  week_start: string | null;
};

/** supabase 클라이언트의 모양만 빌립니다 - 서버·브라우저 어느 쪽이든 들어옵니다. */
type Queryable = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => Record<string, unknown>;
    };
  };
};

/**
 * 그날 요일의 하원수단을 학생 하나당 하나씩.
 *
 * 「그 주만」이 있으면 그것이 답이고, 없으면 「매주」가 답입니다. 지나간 주의 줄은 애초에
 * 읽어오지 않습니다 - 조건에 그 주와 매주만 넣습니다.
 *
 * 못 읽으면 **빈 목록이 아니라 이유를 함께** 돌려줍니다. 하원수단이 없는 것과 못 읽은 것이
 * 화면에서 똑같이 보이면, 아무도 안 데리러 가는 날에도 아무 일 없어 보입니다.
 */
export async function loadDismissalForDay(
  supabase: unknown,
  opts: {
    /** 그날의 한국 날짜(YYYY-MM-DD). */
    dayIso: string;
    /** 1=월 … 5=금. 주말이면 부르지 않습니다. */
    weekday: number;
    /** 셔틀은 빼고 볼 것인가. 「셔틀이 아닌 방법으로 가는 아이」 목록을 만들 때 씁니다. */
    excludeShuttle?: boolean;
    /** 이 아이들만. 담임 화면처럼 자기 반만 보는 자리에서 씁니다. */
    studentIds?: string[];
  },
): Promise<{ rows: DismissalRow[]; byStudent: Map<string, DismissalRow>; error: string | null }> {
  const empty = { rows: [] as DismissalRow[], byStudent: new Map<string, DismissalRow>(), error: null };
  if (opts.weekday < 1 || opts.weekday > 5) return empty;
  if (opts.studentIds && opts.studentIds.length === 0) return empty;

  const ws = weekStartOf(opts.dayIso);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 서버·브라우저 클라이언트를 다 받습니다
  let q: any = (supabase as Queryable).from("student_dismissal_plans").select(DISMISSAL_SELECT);
  q = q.eq("weekday", opts.weekday).or(`week_start.is.null,week_start.eq.${ws}`);
  if (opts.excludeShuttle) q = q.neq("kind", "셔틀");
  if (opts.studentIds) q = q.in("student_id", opts.studentIds);

  const { data, error } = (await q) as { data: DismissalRow[] | null; error: { message: string; code?: string } | null };
  if (error) {
    // 표가 아직 없는 것(마이그레이션 전)은 조용히 넘어갑니다 - 그건 「자료가 없다」가 맞습니다.
    if (error.code === "PGRST205" || error.code === "42P01") return empty;
    return { ...empty, error: error.message };
  }
  const rows = data ?? [];
  return { rows, byStudent: pickByStudent(rows, ws), error: null };
}
