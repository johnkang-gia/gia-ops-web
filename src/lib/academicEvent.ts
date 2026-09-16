/**
 * **긴 준비 기간을 달력에 어떻게 그리는가** — 판정은 여기 한 곳입니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 「크리스마스 콘서트 준비」를 9월 7일~12월 18일로 넣었더니 그 사이 **모든 날**에 막대가
 * 그어졌습니다. 학사 일정은 대개 이렇게 길게 준비하므로, 몇 개만 늘어도 달력은 막대로
 * 가득 차고 정작 그날 무엇을 하는지는 안 보입니다.
 *
 * ── 어떻게 가르나 ───────────────────────────────────────────────────────────
 *
 * 긴 준비 기간은 **기간이 아니라 점들**입니다. 9월 7일부터 매일 무언가를 하는 것이 아니라,
 * 그 사이 몇 번 모여 정하고 마지막에 행사를 합니다.
 *
 *   막대로 그리는 것  학교 **전체가 그 기간 안에 있는 것** (학기·방학·시험기간)과
 *                     2주 이하의 짧은 일 (반배정 기간 등)
 *   점으로 그리는 것  행사와 그 준비 — 행사 당일 하나 + 회의·시작 같은 마디
 *
 * 2주(14일)를 경계로 둡니다. 한 달력 화면이 대개 5~6주라, 3주를 넘는 막대는 화면 절반을
 * 가로지릅니다. 그 정도면 「기간」이 아니라 「배경」이 됩니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

export type EventItemLike = {
  id: string;
  title: string;
  kind?: string | null;
  due_date: string;
  end_date?: string | null;
  /** 행사 당일. 비어 있으면 아직 안 정한 것입니다. */
  event_date?: string | null;
  /** 날짜를 못 정했을 때 사람이 적는 말. 「12월 중」. */
  event_when_note?: string | null;
  done?: boolean;
};

export type MeetingLike = {
  id: string;
  item_id: string;
  seq: number;
  meet_date: string;
  title?: string | null;
  done?: boolean;
};

/** 막대는 **2주까지**입니다. 그보다 길면 달력의 배경이 되어 버립니다. */
export const BAR_MAX_DAYS = 14;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * 이 항목을 달력에 **막대로** 그리는가.
 *
 * 행사는 길이와 상관없이 막대가 아닙니다 - 행사에서 사람이 기억해야 하는 것은 「그날」이지
 * 「준비를 언제부터 했나」가 아닙니다.
 */
export function showAsBar(item: EventItemLike): boolean {
  if ((item.kind ?? "일반") === "행사") return false;
  const end = item.end_date ?? item.due_date;
  return daysBetween(item.due_date, end) <= BAR_MAX_DAYS;
}

/** 달력 칸에 찍는 점 하나. 막대로 안 그리는 항목은 이 점들로만 보입니다. */
export type EventDot = {
  date: string;
  /** 「준비 시작」·「2차 회의」·「행사 당일」 */
  label: string;
  kind: "시작" | "회의" | "행사" | "마감";
  itemId: string;
  title: string;
  done: boolean;
};

/**
 * 막대로 안 그리는 항목을 **점들**로 바꿉니다.
 *
 * 준비 시작·회의·마감·행사 당일만 찍습니다. 그 사이 날들은 **비워 둡니다** — 그날 아무
 * 일도 없어서가 아니라, 달력은 「그날 무엇을 하는가」를 보는 자리이기 때문입니다. 준비가
 * 어디까지 왔는지는 달력 아래 한 줄이 말합니다.
 */
export function eventDots(item: EventItemLike, meetings: MeetingLike[]): EventDot[] {
  if (showAsBar(item)) return [];
  const out: EventDot[] = [];
  const done = !!item.done;

  out.push({ date: item.due_date, label: "준비 시작", kind: "시작", itemId: item.id, title: item.title, done });

  for (const m of meetings.filter((m) => m.item_id === item.id).sort((a, b) => a.seq - b.seq)) {
    out.push({
      date: m.meet_date,
      label: m.title?.trim() || `${m.seq}차 회의`,
      kind: "회의",
      itemId: item.id,
      title: item.title,
      done: !!m.done,
    });
  }

  const eventDay = item.event_date ?? null;
  if (eventDay) {
    out.push({ date: eventDay, label: "행사 당일", kind: "행사", itemId: item.id, title: item.title, done });
  } else if (item.end_date && item.end_date !== item.due_date) {
    // 행사일을 안 정했으면 준비 마감일이라도 찍습니다. 아무 점도 없으면 그 일은 달력에서
    // 통째로 사라집니다.
    out.push({ date: item.end_date, label: "준비 마감", kind: "마감", itemId: item.id, title: item.title, done });
  }
  return out;
}

/**
 * 달력 아래 한 줄 — 「🎄 크리스마스 콘서트 · D-93 · 다음 회의 9/24 (8일 뒤)」.
 *
 * 달력 칸을 한 개도 안 먹으면서 매일 눈에 띄는 자리입니다. 알림이 아니라 **상시 표시**라,
 * 안 보고 지나칠 수는 있어도 「몰랐다」가 되지는 않습니다.
 */
export type EventProgress = {
  itemId: string;
  title: string;
  /** 「D-93」 또는 「오늘」 또는 「12월 중(미정)」 */
  when: string;
  /** 「다음 회의 9/24 (8일 뒤)」 — 남은 회의가 없으면 null */
  nextMeeting: string | null;
  /** 오늘이 행사일이거나 사흘 안쪽인가. 화면이 색을 바꿉니다. */
  soon: boolean;
};

export function eventProgress(item: EventItemLike, meetings: MeetingLike[], today: string): EventProgress | null {
  if (showAsBar(item)) return null;
  if (item.done) return null;

  // **지난 행사는 내립니다.** 끝난 일이 줄에 남아 있으면 그 줄을 아무도 안 읽게 됩니다.
  const last = item.event_date ?? item.end_date ?? item.due_date;
  if (daysBetween(today, last) < 0) return null;

  let when: string;
  let soon = false;
  if (item.event_date) {
    const d = daysBetween(today, item.event_date);
    when = d === 0 ? "오늘" : d > 0 ? `D-${d}` : `D+${-d}`;
    soon = d >= 0 && d <= 3;
  } else {
    // 가짜 날짜를 넣지 않습니다 - 임시 날짜는 확정처럼 읽혀 준비가 그날로 굳습니다.
    when = item.event_when_note?.trim() ? `${item.event_when_note.trim()} (날짜 미정)` : "날짜 미정";
  }

  const next = meetings
    .filter((m) => m.item_id === item.id && !m.done && daysBetween(today, m.meet_date) >= 0)
    .sort((a, b) => a.meet_date.localeCompare(b.meet_date))[0];

  const nextMeeting = next
    ? (() => {
        const d = daysBetween(today, next.meet_date);
        const label = next.title?.trim() || `${next.seq}차 회의`;
        return `${label} ${next.meet_date.slice(5).replace("-", "/")}${d === 0 ? " (오늘)" : ` (${d}일 뒤)`}`;
      })()
    : null;

  return { itemId: item.id, title: item.title, when, nextMeeting, soon };
}

/** 진행 줄 여러 개. 가까운 것이 먼저입니다. */
export function eventProgressList(items: EventItemLike[], meetings: MeetingLike[], today: string): EventProgress[] {
  return items
    .map((it) => eventProgress(it, meetings, today))
    .filter((p): p is EventProgress => !!p)
    .sort((a, b) => {
      // 날짜가 정해진 것이 먼저, 그 안에서는 가까운 것부터. 미정은 뒤로 — 미정인 일에
      // 사람이 오늘 할 수 있는 것은 「날짜를 정하는 것」뿐입니다.
      const an = a.when.startsWith("D-") ? Number(a.when.slice(2)) : a.when === "오늘" ? -1 : 9999;
      const bn = b.when.startsWith("D-") ? Number(b.when.slice(2)) : b.when === "오늘" ? -1 : 9999;
      return an - bn;
    });
}
