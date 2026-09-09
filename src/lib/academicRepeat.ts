/**
 * **학사일정이 언제 되풀이되는가** — 한 곳에서만 셉니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 학사일정 규칙은 「학기 시작 · 종료일 기준 며칠 전」만 알았습니다. 그래서 학기와 상관없는
 * 되풀이 업무 - 매년 같은 달에 내는 공고, 매달 하는 안전점검, 매주 여는 회의 - 는 규칙에
 * 적을 자리가 없었고, 사람이 매번 손으로 업무를 만들었습니다. 손으로 만드는 일은 바쁜 주에
 * 빠지는데, **빠져도 화면에는 아무 표시가 안 납니다.** 안 한 일과 없는 일이 똑같이 보입니다.
 *
 * ── 왜 계산을 여기에 두나 ────────────────────────────────────────────
 *
 * 「학기시작 2주 전」 같은 날짜 계산은 화면·크론·미리보기 세 군데가 각자 하면 반드시
 * 갈립니다. 화면에는 3월 2일이라고 떠 있는데 실제로 업무가 3월 3일에 올라오는 식입니다.
 * 그래서 계산은 여기만 하고, 부르는 쪽은 결과만 씁니다. 저장은 하지 않으므로 시험할 수
 * 있습니다.
 */

export type RepeatKind = "term" | "year" | "month" | "week";

export type RepeatRule = {
  kind: RepeatKind;
  /** 매년: 몇 월(1-12). */
  month?: number | null;
  /** 매년·매달: 며칠(1-31). */
  day?: number | null;
  /** 매주: 요일(0=일 … 6=토). */
  dow?: number | null;
};

/** 'YYYY-MM-DD' 로 적습니다. 시간대를 타지 않도록 문자열로만 다룹니다. */
function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function parseKey(key: string): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!hit) return null;
  return { y: Number(hit[1]), m: Number(hit[2]), d: Number(hit[3]) };
}

/**
 * 그 달에 **없는 날은 마지막 날로 당깁니다.**
 *
 * 「매달 31일 점검」을 2월에 건너뛰면 2월만 점검이 사라지는데, 사라진 것은 아무도 못
 * 봅니다. 하루 당겨서라도 남아 있는 편이 훨씬 낫습니다 - 날짜가 마음에 안 들면 사람이
 * 보고 옮길 수 있지만, 없는 일은 옮길 수조차 없습니다.
 */
function clampDay(y: number, m: number, d: number): string {
  return keyOf(y, m, Math.min(Math.max(1, d), daysInMonth(y, m)));
}

/**
 * `from` 부터 `to` 까지(양 끝 포함) 이 규칙이 걸리는 날들.
 *
 * 'term' 은 여기서 다루지 않습니다 - 학기 기준은 학기의 시작·종료일이 있어야 정해지므로
 * `anchorDate()` 쪽입니다. 빈 배열을 돌려주어 부르는 쪽이 갈라 쓰게 합니다.
 */
export function repeatDates(rule: RepeatRule, from: string, to: string): string[] {
  const a = parseKey(from);
  const b = parseKey(to);
  if (!a || !b || from > to) return [];

  const out: string[] = [];

  if (rule.kind === "year") {
    const m = rule.month ?? 1;
    const d = rule.day ?? 1;
    if (m < 1 || m > 12) return [];
    for (let y = a.y; y <= b.y; y++) {
      const key = clampDay(y, m, d);
      if (key >= from && key <= to) out.push(key);
    }
    return out;
  }

  if (rule.kind === "month") {
    const d = rule.day ?? 1;
    let y = a.y;
    let m = a.m;
    // 열두 달치 상한을 둡니다. 규칙이 잘못 들어와도 무한히 돌지 않도록.
    for (let guard = 0; guard < 400; guard++) {
      const key = clampDay(y, m, d);
      if (key > to) break;
      if (key >= from) out.push(key);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  if (rule.kind === "week") {
    const dow = rule.dow ?? 1;
    if (dow < 0 || dow > 6) return [];
    // 시작일 이후 처음 오는 그 요일부터 7일씩.
    const cur = new Date(a.y, a.m - 1, a.d);
    cur.setDate(cur.getDate() + ((dow - cur.getDay() + 7) % 7));
    for (let guard = 0; guard < 400; guard++) {
      const key = keyOf(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      if (key > to) break;
      out.push(key);
      cur.setDate(cur.getDate() + 7);
    }
    return out;
  }

  return [];
}

/** 날짜에서 며칠 **앞으로** 당깁니다(offset 은 「며칠 전」이라 양수가 과거입니다). */
export function shiftBack(date: string, offsetDays: number): string {
  const p = parseKey(date);
  if (!p) return date;
  const d = new Date(p.y, p.m - 1, p.d);
  d.setDate(d.getDate() - offsetDays);
  return keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export type AnchorNode = {
  id: string;
  /** 다른 규칙을 기준으로 삼을 때 그 규칙. 없으면 학기 기준입니다. */
  anchorTemplateId?: string | null;
  anchor: "term_start" | "term_end";
  offsetDays: number;
};

/**
 * 「다른 학사일정 기준 N일 전」을 풀어 실제 날짜로 만듭니다.
 *
 * 학교 일은 사슬로 엮여 있습니다 - 「반배정 2주 전에 학생명단 확정」처럼요. 기준을 늘
 * 학기 시작으로만 적으면, 반배정이 밀렸을 때 앞 일정은 옛 날짜에 그대로 남습니다.
 *
 * **고리는 끊고 null 을 돌려줍니다.** A가 B를, B가 A를 기준으로 삼으면 어느 쪽도 날짜를
 * 가질 수 없습니다. 그때 아무 날짜나 정하면 그 날짜가 사실처럼 굳어버리므로, 정하지 못했다는
 * 것을 그대로 알립니다 - 부르는 쪽이 「기준 일정이 서로 물려 있습니다」라고 사람에게 말합니다.
 */
export function anchorDate(
  node: AnchorNode,
  all: Map<string, AnchorNode>,
  term: { start: string | null; end: string | null },
): string | null {
  const seen = new Set<string>();
  let cur: AnchorNode | undefined = node;
  let offset = 0;

  while (cur) {
    if (seen.has(cur.id)) return null; // 고리
    seen.add(cur.id);
    offset += cur.offsetDays;

    if (!cur.anchorTemplateId) {
      const base = cur.anchor === "term_start" ? term.start : term.end;
      return base ? shiftBack(base, offset) : null;
    }
    cur = all.get(cur.anchorTemplateId);
  }
  // 기준으로 삼은 규칙이 지워졌습니다. 학기 기준으로 슬그머니 바꾸지 않습니다 -
  // 그러면 엉뚱한 날짜가 «정상»으로 보입니다.
  return null;
}

export const REPEAT_LABEL: Record<RepeatKind, string> = {
  term: "매 학기",
  year: "매년",
  month: "매달",
  week: "매주",
};

export const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/** 규칙을 사람 말로 한 줄. 화면 여러 곳이 같은 문장을 쓰도록 여기 둡니다. */
export function describeRepeat(rule: RepeatRule, offsetDays: number, anchorName?: string | null): string {
  if (rule.kind === "year") return `매년 ${rule.month ?? 1}월 ${rule.day ?? 1}일`;
  if (rule.kind === "month") return `매달 ${rule.day ?? 1}일`;
  if (rule.kind === "week") return `매주 ${DOW_LABEL[rule.dow ?? 1]}요일`;
  const base = anchorName ? `「${anchorName}」` : "학기 시작일";
  if (offsetDays === 0) return `매 학기 ${base} 당일`;
  return offsetDays > 0 ? `매 학기 ${base} ${offsetDays}일 전` : `매 학기 ${base} ${-offsetDays}일 후`;
}
