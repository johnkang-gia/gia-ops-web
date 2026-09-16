/**
 * **등록해 둔 일정 찾기** — 업무 달력과 학사일정이 같은 규칙으로 찾습니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 일정이 쌓이면 「그거 언제였지」를 달마다 넘겨보며 찾게 됩니다. 크리스마스 콘서트처럼
 * 석 달 뒤 것은 화살표를 세 번 눌러야 나오고, 지난 것은 몇 번을 눌러야 하는지도 모릅니다.
 * 그러면 대개 찾다 말고 옆 사람에게 물어봅니다.
 *
 * ── 어떻게 찾나 ─────────────────────────────────────────────────────────────
 *
 * 제목·설명을 **띄어쓰기와 대소문자를 무시하고** 훑습니다. 「PBL Field Trip」을 「pblfield」
 * 로 쳐도 나와야 합니다 - 정확히 치게 하면 정확히 치는 법을 아는 사람만 쓰게 됩니다.
 *
 * 순서는 **오늘에서 가까운 앞날이 먼저**입니다. 찾는 이유는 대개 「이제 뭘 해야 하지」이고,
 * 지난 것은 참고입니다. 다만 지난 것도 **빼지 않습니다** - 작년에 뭘 했는지 보려고 찾는
 * 경우가 있고, 없으면 없는 줄 압니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

export type SearchHit = {
  id: string;
  /** 업무인가 학사일정인가. 화면이 색과 아이콘을 가릅니다. */
  kind: "업무" | "학사";
  title: string;
  /** 달력을 이 날로 옮깁니다. 기간짜리는 시작일. */
  date: string | null;
  /** 「9/28 · 3일」처럼 화면에 적는 한 줄. */
  when: string;
  /** 오늘 기준 며칠 뒤인가. 지난 것은 음수. 날짜가 없으면 null. */
  dayDiff: number | null;
};

export type SearchableTask = {
  id: string;
  title: string;
  description?: string | null;
  /** 마감(ISO 또는 날짜). 없으면 「마감 없음」. */
  dueAt?: string | null;
  startOn?: string | null;
};

export type SearchableAcademic = {
  id: string;
  title: string;
  description?: string | null;
  due_date: string;
  end_date?: string | null;
  event_date?: string | null;
};

/** 띄어쓰기·대소문자를 지운 글자. 치는 사람이 규칙을 외우지 않아도 되게. */
export function flat(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, "");
}

function diff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 화면에 적는 날짜 한 줄. 「9/28」·「9/28~9/30」·「마감 없음」. */
export function whenLabel(from: string | null, to: string | null): string {
  if (!from) return "마감 없음";
  const f = from.slice(5).replace("-", "/");
  if (!to || to === from) return f;
  return `${f}~${to.slice(5).replace("-", "/")}`;
}

/**
 * 업무 + 학사일정을 한 목록으로 찾습니다.
 *
 * 두 갈래를 따로 찾게 하면 사람은 두 번 칩니다. 어느 쪽에 등록했는지는 기억하지 못하는
 * 경우가 더 많습니다 - 「크리스마스 콘서트」가 업무인지 학사인지는 등록한 사람만 압니다.
 */
export function searchSchedules(
  q: string,
  tasks: SearchableTask[],
  academics: SearchableAcademic[],
  today: string,
  limit = 12,
): SearchHit[] {
  const needle = flat(q);
  if (needle.length < 1) return [];

  const hits: SearchHit[] = [];

  for (const t of tasks) {
    if (!flat(`${t.title} ${t.description ?? ""}`).includes(needle)) continue;
    // 마감 시각은 버리고 날짜만 씁니다 - 달력은 날짜로 넘깁니다.
    const due = t.dueAt ? t.dueAt.slice(0, 10) : null;
    const start = t.startOn ?? due;
    hits.push({
      id: t.id,
      kind: "업무",
      title: t.title,
      date: start,
      when: whenLabel(start, due),
      dayDiff: start ? diff(today, start) : null,
    });
  }

  for (const a of academics) {
    if (!flat(`${a.title} ${a.description ?? ""}`).includes(needle)) continue;
    // 행사면 **당일**로 옮깁니다 - 「크리스마스 콘서트」를 찾는 사람이 보려는 것은 준비
    // 시작일이 아니라 그날입니다.
    const jump = a.event_date ?? a.due_date;
    hits.push({
      id: a.id,
      kind: "학사",
      title: a.title,
      date: jump,
      when: a.event_date ? whenLabel(a.event_date, null) : whenLabel(a.due_date, a.end_date ?? null),
      dayDiff: diff(today, jump),
    });
  }

  return hits
    .sort((x, y) => {
      // 앞날이 먼저, 그중 가까운 것부터. 지난 것은 뒤로 보내되 최근 것이 위입니다.
      const ax = x.dayDiff ?? 99999;
      const ay = y.dayDiff ?? 99999;
      const fx = ax >= 0 ? ax : 10000 - ax;
      const fy = ay >= 0 ? ay : 10000 - ay;
      return fx - fy || x.title.localeCompare(y.title, "ko");
    })
    .slice(0, limit);
}
