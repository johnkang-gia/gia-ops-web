/**
 * 달력에서 **여러 날에 걸친 일정을 한 줄로** 그리기 위한 계산 — 한 곳에서만 합니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 마감일 하나만 있으니 「10일부터 14일까지 학기말 정리」가 14일 칸에 점 하나로 찍혔습니다.
 * 달력을 두는 이유는 **언제 몰려 있나**를 보는 것인데, 그게 안 보이면 달력을 둔 값을 못
 * 합니다.
 *
 * ── 왜 계산을 따로 떼어놨나 ──────────────────────────────────────────
 *
 * 「이 막대가 이번 주 몇 번째 칸에서 시작해 몇 칸을 차지하고 몇 번째 줄에 앉는가」는 손으로
 * 확인하기가 어렵습니다 - 화면을 띄워 눈으로 보는 수밖에 없고, 달을 넘길 때·주가 갈릴 때만
 * 어긋나는 종류의 오류는 그렇게 해서는 못 찾습니다. 순수 함수로 두면 **시험으로** 확인합니다.
 */

/** 하루짜리든 여러 날이든, 달력에 그릴 한 건. */
export type SpanTask = {
  id: string;
  title: string;
  /** 시작일(YYYY-MM-DD). 비어 있으면 하루짜리입니다. */
  startOn: string | null;
  /** 끝날(YYYY-MM-DD). 마감일의 한국 날짜입니다. 없으면 달력에 자리가 없습니다. */
  endOn: string | null;
};

/** 한 주(7칸) 안에서 막대 하나가 앉을 자리. */
export type SpanBar<T extends SpanTask = SpanTask> = {
  task: T;
  /** 그 주에서 몇 번째 칸부터(0=일요일). */
  col: number;
  /** 몇 칸을 차지하는가(1~7). */
  span: number;
  /** 몇 번째 줄에 앉는가(0부터). 겹치면 아래로 내려갑니다. */
  lane: number;
  /** 이 주 이전부터 이어져 온 것인가 — 왼쪽 끝을 둥글게 하지 않습니다. */
  continuesLeft: boolean;
  /** 다음 주로 이어지는가. */
  continuesRight: boolean;
};

/** 하루 차이. 둘 다 YYYY-MM-DD 라고 보고 UTC 로 계산합니다(시간대에 흔들리지 않게). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** 여러 날에 걸친 일정인가. 하루짜리는 칸 안에 그냥 적습니다 - 막대로 만들면 자리만 먹습니다. */
export function isSpan(t: SpanTask): boolean {
  return !!t.startOn && !!t.endOn && daysBetween(t.startOn, t.endOn) >= 1;
}

/**
 * 한 주(7칸)에 그릴 막대들을 배치합니다.
 *
 * `weekStart` 는 그 주 일요일의 날짜키입니다. 주를 벗어나는 일정은 **잘라서** 넣고, 잘렸다는
 * 사실을 `continuesLeft/Right` 로 남깁니다 - 잘린 티가 안 나면 보는 사람은 그 주에서
 * 끝나는 일로 읽습니다.
 *
 * 줄(lane)은 **먼저 시작한 것이 위**입니다. 같은 날 시작이면 긴 것이 위 - 짧은 것이 위에
 * 앉으면 긴 막대가 여러 줄로 흩어져 보입니다.
 */
export function layoutWeek<T extends SpanTask>(tasks: T[], weekStart: string): SpanBar<T>[] {
  const weekEnd = addDays(weekStart, 6);

  const inWeek = tasks
    .filter((t) => isSpan(t))
    .map((t) => ({ t, from: t.startOn as string, to: t.endOn as string }))
    // 주와 한 칸이라도 겹치는 것만.
    .filter((x) => x.from <= weekEnd && x.to >= weekStart)
    .sort((a, b) => a.from.localeCompare(b.from) || daysBetween(b.from, b.to) - daysBetween(a.from, a.to) || a.t.id.localeCompare(b.t.id));

  // 줄마다 «어디까지 찼는지»만 기억하면 됩니다. 왼쪽에서 오른쪽으로 채우니, 그 줄의 마지막
  // 칸보다 뒤에서 시작하면 같은 줄에 앉습니다.
  const laneEnd: number[] = [];
  const out: SpanBar<T>[] = [];

  for (const x of inWeek) {
    const startCol = Math.max(0, daysBetween(weekStart, x.from));
    const endCol = Math.min(6, daysBetween(weekStart, x.to));
    if (endCol < startCol) continue;

    let lane = laneEnd.findIndex((end) => end < startCol);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(endCol);
    } else {
      laneEnd[lane] = endCol;
    }

    out.push({
      task: x.t,
      col: startCol,
      span: endCol - startCol + 1,
      lane,
      continuesLeft: x.from < weekStart,
      continuesRight: x.to > weekEnd,
    });
  }
  return out;
}

/** 날짜키에 며칠 더하기. 달·해가 넘어가도 맞습니다. */
export function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 끌어서 고른 두 날짜를 **앞뒤 순서대로** 돌려줍니다.
 *
 * 사람은 오른쪽에서 왼쪽으로도 끕니다. 그대로 저장하면 시작일이 끝날보다 뒤가 되어, 달력에서
 * 그 일정이 아예 안 보입니다 - 오류도 안 나고 그냥 사라집니다.
 */
export function orderRange(a: string, b: string): { from: string; to: string } {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}
