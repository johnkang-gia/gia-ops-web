/**
 * 하원수단이 **몇 주짜리인가** — 한 곳에서만 정합니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 하원수단은 「학생 × 요일」 한 줄뿐이었고, 그 한 줄은 **영원히 매주**를 뜻했습니다.
 * 그런데 실제로 들어오는 연락의 대부분은 그 주 한 번짜리입니다.
 *
 *   · "이번 주 목요일만 할머니가 데리러 갑니다"
 *   · "다음 주부터 화·목 학원차 탑니다"
 *
 * 앞엣것을 적을 자리가 없어서 두 가지 중 하나가 됐습니다. 매주로 적어두고 **다음 주에
 * 지우기를 잊거나**(그러면 매주 목요일마다 할머니를 기다립니다), 아예 안 적고 사람이
 * 기억하거나(그러면 그날 아무도 모릅니다). 둘 다 오류로 안 보입니다 - 화면에는 그럴듯한
 * 값이 적혀 있습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 줄마다 「어느 주인가」를 붙입니다. `weekStart` 는 그 주의 **월요일 날짜**이고,
 * **비어 있으면 매주**입니다. 비어 있는 것이 매주인 이유는 이미 쌓인 줄들이 전부 매주였기
 * 때문입니다 - 옛 자료가 갑자기 뜻을 바꾸면 안 됩니다.
 *
 * 같은 요일에 둘 다 있으면 **그 주짜리가 이깁니다.** 매주 셔틀을 타는 아이가 이번 주
 * 목요일만 할머니와 간다면, 그 목요일의 답은 할머니입니다.
 */

/** 하원수단을 언제까지 적용할 것인가. 화면의 단추 세 개와 같은 순서입니다. */
export const DISMISSAL_REPEATS = ["이번주", "다음주", "매주"] as const;
export type DismissalRepeat = (typeof DISMISSAL_REPEATS)[number];

export const REPEAT_HINT: Record<DismissalRepeat, string> = {
  이번주: "이번 주만. 다음 주에는 저절로 없어집니다",
  다음주: "다음 주만. 그 주가 지나면 저절로 없어집니다",
  매주: "지울 때까지 매주 같은 요일",
};

/**
 * 그 날짜가 속한 주의 **월요일**(KST 기준 날짜 문자열).
 *
 * 날짜 문자열만 가지고 셉니다 - `new Date(iso)` 는 세계표준시 자정으로 읽혀서, 한국의
 * 월요일이 일요일로 밀립니다. 이 저장소에서 이미 다섯 번 난 실수라 시각을 아예 안 씁니다.
 *
 * 주말(토·일)은 **다음 주 월요일**로 넘깁니다. 하원수단은 평일에만 있으므로, 토요일에
 * 「이번주」로 넣으면 사람이 뜻하는 것은 지나간 주가 아니라 곧 오는 주입니다.
 */
export function weekStartOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`날짜 형식이 아닙니다: ${iso}`);
  // 1970-01-01 은 목요일. UTC 로만 계산하므로 시간대에 흔들리지 않습니다.
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const dow = (days + 4) % 7; // 0=일 … 6=토
  const shift = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  return isoFromDays(days + shift);
}

/** 그 주의 다음 주 월요일. */
export function nextWeekStart(iso: string): string {
  return addDays(weekStartOf(iso), 7);
}

/** 날짜에 며칠 더하기. 문자열로만 셉니다(시간대 없음). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoFromDays(Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) + n);
}

function isoFromDays(days: number): string {
  const dt = new Date(days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 고른 반복이 뜻하는 `week_start` 값. **매주는 null** 입니다.
 *
 * null 을 「값이 없다」가 아니라 「매주」로 쓰는 것이 이상해 보일 수 있는데, 이미 쌓인
 * 줄들이 전부 이 상태이고 그 줄들의 뜻이 매주입니다. 새 뜻을 만들어 옛 줄을 옮기면
 * 옮기다 만 줄이 남고, 그건 화면에 오류로 안 보입니다.
 */
export function weekStartFor(repeat: DismissalRepeat, todayIso: string): string | null {
  if (repeat === "매주") return null;
  if (repeat === "다음주") return nextWeekStart(todayIso);
  return weekStartOf(todayIso);
}

/** 어느 주의 줄인지를 사람 말로. 목록에 붙는 작은 글씨입니다. */
export function describeWeek(weekStart: string | null, todayIso: string): string {
  if (!weekStart) return "매주";
  const here = weekStartOf(todayIso);
  if (weekStart === here) return "이번주만";
  if (weekStart === nextWeekStart(todayIso)) return "다음주만";
  const [, m, d] = weekStart.split("-");
  // 지난 주 줄은 「지난」이라고 못박습니다. 날짜만 적어두면 아직 사는 줄로 보입니다.
  const label = `${Number(m)}/${Number(d)} 주`;
  return weekStart < here ? `지난 ${label}` : label;
}

/** 그 주에 적용되는 줄인가. 매주(null)는 언제나 적용됩니다. */
export function appliesToWeek(weekStart: string | null, targetWeekStart: string): boolean {
  return weekStart === null || weekStart === targetWeekStart;
}

/**
 * 같은 요일에 여럿이면 **그 주짜리가 이깁니다.**
 *
 * 매주 셔틀인 아이가 이번 주 목요일만 할머니와 간다면 그 목요일의 답은 할머니입니다.
 * 둘 다 보여주면 보는 사람이 어느 쪽인지 정해야 하는데, 그건 화면이 할 일입니다.
 */
export function pickForWeek<T extends { week_start?: string | null }>(
  rows: readonly T[],
  targetWeekStart: string,
): T | null {
  let weekly: T | null = null;
  for (const r of rows) {
    const ws = r.week_start ?? null;
    if (ws === targetWeekStart) return r;
    if (ws === null && !weekly) weekly = r;
  }
  return weekly;
}

/**
 * 학생별로 그 주의 답 하나씩. 읽는 자리 아홉 곳이 같은 규칙을 쓰게 하는 자리입니다.
 *
 * 이 규칙을 화면마다 다시 쓰면 어느 화면은 할머니를, 어느 화면은 셔틀을 보여주게 되고,
 * 그러면 아무도 어느 쪽이 맞는지 모릅니다.
 */
export function pickByStudent<T extends { student_id: string; week_start?: string | null }>(
  rows: readonly T[],
  targetWeekStart: string,
): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const r of rows) {
    const list = grouped.get(r.student_id);
    if (list) list.push(r);
    else grouped.set(r.student_id, [r]);
  }
  const out = new Map<string, T>();
  for (const [sid, list] of grouped) {
    const picked = pickForWeek(list, targetWeekStart);
    if (picked) out.set(sid, picked);
  }
  return out;
}

/**
 * 지난 주짜리 줄인가. 지나간 한 주짜리는 답에 넣지 않습니다.
 *
 * 지우는 일은 사람이 하지 않습니다 - 사람이 지워야 하는 목록은 언젠가 안 지워집니다.
 * 화면은 무시하고, 표는 크론이 2주 뒤에 치웁니다.
 */
export function isExpired(weekStart: string | null, todayIso: string): boolean {
  return weekStart !== null && weekStart < weekStartOf(todayIso);
}
