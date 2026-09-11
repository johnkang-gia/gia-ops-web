import { pickByStudent, weekStartOf } from "./dismissalWeek";
import { assumeAfternoon } from "./pickupParse";
import { logApiError } from "./logging";

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
/** `week_start` 가 아직 없는 데이터베이스에서 쓰는 목록. 이때는 모든 줄이 「매주」입니다. */
export const DISMISSAL_SELECT_LEGACY = "student_id, weekday, kind, label, depart_time, note";

/**
 * **칸이 아직 없는 상태인가.**
 *
 * 코드는 배포됐는데 마이그레이션이 아직 안 돌면 이 오류가 납니다. 그 사이에도 아이들은
 * 집에 가야 하므로, 화면을 멈추는 대신 **있는 칸만으로 읽어 「매주」로 씁니다.**
 *
 * 다만 조용히 넘어가지는 않습니다 - 「이번주만」으로 넣어둔 하원수단이 안 보이는 상태이고,
 * 그건 사람이 알아야 고칩니다.
 */
export function isMissingWeekStart(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || (error.message ?? "").includes("week_start");
}

/** 사람에게 보여줄 안내. 무엇이 안 보이는지와 무엇을 해야 하는지를 함께 적습니다. */
export const WEEK_START_NOTICE =
  "「이번주만·다음주만」 하원수단은 아직 안 보입니다. 지금은 매주 하원수단만 읽고 있습니다 — 관리자에게 스키마 반영을 알려주세요(20260914000000_dismissal_week.sql).";

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
): Promise<{
  rows: DismissalRow[];
  byStudent: Map<string, DismissalRow>;
  error: string | null;
  /** 읽기는 읽었는데 반쪽인 경우의 안내. 오류가 아니라 「지금 이만큼만 보입니다」입니다. */
  notice: string | null;
}> {
  const empty = { rows: [] as DismissalRow[], byStudent: new Map<string, DismissalRow>(), error: null, notice: null };
  if (opts.weekday < 1 || opts.weekday > 5) return empty;
  if (opts.studentIds && opts.studentIds.length === 0) return empty;

  const ws = weekStartOf(opts.dayIso);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 서버·브라우저 클라이언트를 다 받습니다
  const build = (legacy: boolean): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = (supabase as Queryable)
      .from("student_dismissal_plans")
      .select(legacy ? DISMISSAL_SELECT_LEGACY : DISMISSAL_SELECT);
    q = q.eq("weekday", opts.weekday);
    if (!legacy) q = q.or(`week_start.is.null,week_start.eq.${ws}`);
    if (opts.excludeShuttle) q = q.neq("kind", "셔틀");
    if (opts.studentIds) q = q.in("student_id", opts.studentIds);
    return q;
  };

  let { data, error } = (await build(false)) as {
    data: DismissalRow[] | null;
    error: { message: string; code?: string } | null;
  };
  let notice: string | null = null;

  // **칸이 아직 없으면 있는 칸만으로 다시 읽습니다.**
  //
  // 코드는 배포됐는데 마이그레이션이 아직 안 돈 사이입니다. 그 사이에도 아이들은 집에
  // 가야 하고, 여기서 멈추면 오늘 학원차 타는 아이가 아무 화면에도 안 뜹니다.
  if (isMissingWeekStart(error)) {
    const retry = (await build(true)) as { data: DismissalRow[] | null; error: { message: string } | null };
    data = (retry.data ?? []).map((r) => ({ ...r, week_start: null }));
    error = retry.error;
    notice = WEEK_START_NOTICE;
    // **오류 목록에도 남깁니다.**
    //
    // 예전에는 이런 실패를 `console.error` 로만 적었습니다. 그건 Vercel 로그로만 가고,
    // 앱 안의 「오류 목록」(error_logs)에는 안 들어옵니다 - 그래서 화면에는 빨간 줄이
    // 떴는데 오류 목록은 비어 있는, 사람이 헷갈리는 상태가 됐습니다.
    // logApiError 는 실패해도 조용히 넘어가므로 여기서 불러도 안전합니다.
    await logApiError(supabase, "dismissal:read", new Error(`week_start 칸이 아직 없습니다. ${WEEK_START_NOTICE}`));
  }

  if (error) {
    // 표가 아직 없는 것(마이그레이션 전)은 조용히 넘어갑니다 - 그건 「자료가 없다」가 맞습니다.
    if (error.code === "PGRST205" || error.code === "42P01") return empty;
    await logApiError(supabase, "dismissal:read", new Error(error.message));
    return { ...empty, error: error.message };
  }
  // **시각을 읽을 때 바로잡습니다.**
  //
  // 하원수단의 출발 시각은 사람이 손으로 치는 칸이라 「3:35」·「1:55」처럼 앞자리를 안
  // 채웁니다. 학교 일은 낮에만 일어나므로 그건 오후입니다 - 그대로 두면 백서아의
  // 블루웨일버스가 화면에 **새벽 3시 35분**으로 뜨고, 시각 순 정렬에서도 맨 앞으로 올라와
  // 「가장 먼저 나가는 아이」로 보입니다.
  //
  // 저장을 고치지 않고 읽을 때 바로잡는 이유는 **이미 쌓인 줄이 있고 그것들도 오늘 화면에
  // 떠야 하기 때문**입니다. 넣을 때도 함께 맞추지만, 읽는 쪽이 마지막 그물입니다.
  const rows = (data ?? []).map((r) => ({ ...r, depart_time: assumeAfternoon(r.depart_time) }));
  return { rows, byStudent: pickByStudent(rows, ws), error: null, notice };
}
