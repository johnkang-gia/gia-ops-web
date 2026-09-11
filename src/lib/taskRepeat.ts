import type { Task, TaskRecurrence } from "./types";

/**
 * **되풀이 업무가 앞으로 언제 오는가** — 달력에 미리 그리기 위한 계산.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 되풀이 규칙은 이미 있었습니다(`recurrence`). 그런데 그 규칙은 **완료를 누른 뒤에야** 다음
 * 회차를 만듭니다. 그래서 달력에는 언제나 **이번 한 번**만 떠 있었습니다.
 *
 * 달력을 두는 이유는 「다음 주에 뭐가 잡혀 있지」를 보는 것인데, 매주 도는 일이 다음 주
 * 칸에 안 뜨면 그 물음에 답을 못 합니다. 사람은 결국 머리로 「금요일마다 그거 있지」를
 * 기억해야 하고, 기억해야 하는 것은 언젠가 빠집니다.
 *
 * ── 왜 줄을 미리 만들지 않는가 ──────────────────────────────────────────────
 *
 * 「매주 금요일」을 1년치 줄로 만들면 52줄이 흐름판에 쌓입니다. 흐름판은 **지금 해야 할
 * 일**을 보는 자리인데, 반년 뒤 회의가 거기 끼어 있으면 쓸모가 줄어듭니다. 제목 하나를
 * 고치려 해도 52줄을 고쳐야 합니다.
 *
 * 그래서 **줄은 그대로 한 개**이고, 달력이 규칙을 펼쳐서 **앞날 자리만 미리 보여줍니다.**
 * 미리 보여주는 것은 아직 만들어지지 않은 예정이라, 화면에서 점선으로 그려 진짜 줄과
 * 구별합니다 - 같아 보이면 사람은 그것도 누를 수 있다고 믿습니다.
 */

const DAY_MS = 86_400_000;

/** YYYY-MM-DD 를 UTC 로 셈합니다. 시간대에 흔들리지 않게 날짜키만 다룹니다. */
function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** 그 달의 마지막 날. 31일 규칙이 2월에 닿으면 28·29일로 내립니다. */
function lastDayOf(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * `anchorKey` **다음** 회차들 중 `fromKey`~`toKey` 안에 드는 날짜.
 *
 * 기준일 자신은 넣지 않습니다 - 그 자리에는 진짜 줄이 이미 있습니다. 넣으면 같은 날에
 * 진짜와 예정이 겹쳐 뜨고, 보는 사람은 일이 두 개인 줄 압니다.
 *
 * `max` 는 안전장치입니다. 규칙이 이상해도(예: 매일 + 10년치 범위) 화면이 멈추지 않게
 * 세는 것을 끊습니다.
 */
export function occurrencesBetween(
  rule: NonNullable<TaskRecurrence>,
  anchorKey: string,
  fromKey: string,
  toKey: string,
  max = 64,
): string[] {
  if (!anchorKey || fromKey > toKey) return [];
  const out: string[] = [];

  if (rule.freq === "daily") {
    // 기준일보다 뒤이면서 범위 안인 첫날부터 하루씩.
    let d = anchorKey < fromKey ? fromKey : addDays(anchorKey, 1);
    while (d <= toKey && out.length < max) {
      if (d > anchorKey) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  if (rule.freq === "weekly") {
    const target = rule.weekday ?? weekdayOf(anchorKey);
    // 기준일 다음 날부터 그 요일을 찾습니다.
    let d = addDays(anchorKey, 1);
    while (weekdayOf(d) !== target) d = addDays(d, 1);
    // 범위 앞이면 주 단위로 건너뜁니다. 하루씩 세면 몇 달 뒤 범위에서 느려집니다.
    if (d < fromKey) {
      const jump = Math.floor((Date.parse(`${fromKey}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / (7 * DAY_MS));
      d = addDays(d, jump * 7);
      while (d < fromKey) d = addDays(d, 7);
    }
    while (d <= toKey && out.length < max) {
      out.push(d);
      d = addDays(d, 7);
    }
    return out;
  }

  // 매월 — 날짜(day_of_month)를 그 달 마지막 날로 눌러 맞춥니다.
  const dom = rule.day_of_month ?? Number(anchorKey.slice(8, 10));
  const [ay, am] = [Number(anchorKey.slice(0, 4)), Number(anchorKey.slice(5, 7)) - 1];
  for (let i = 1; i <= 400 && out.length < max; i += 1) {
    const y = ay + Math.floor((am + i) / 12);
    const m0 = (am + i) % 12;
    const day = Math.min(dom, lastDayOf(y, m0));
    const key = `${y}-${String(m0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (key > toKey) break;
    if (key >= fromKey && key > anchorKey) out.push(key);
  }
  return out;
}

/** 달력에 점선으로 그릴 「아직 안 만들어진 회차」. */
export type GhostOccurrence = {
  /** 원본 업무. 눌렀을 때 여는 것도 이것입니다 - 회차는 아직 줄이 아닙니다. */
  task: Task;
  dayKey: string;
};

/**
 * 보이는 범위(`fromKey`~`toKey`) 안의 예정 회차를 모읍니다.
 *
 * **이미 진짜 줄이 있는 날은 뺍니다.** 같은 되풀이 묶음(`recurrence_group_id`)에서 이미
 * 만들어진 회차가 그날에 있으면, 예정을 겹쳐 그리면 안 됩니다 - 한 일이 두 개로 보입니다.
 */
export function ghostOccurrences(
  tasks: Task[],
  fromKey: string,
  toKey: string,
  dayKeyOf: (iso: string | null) => string | null,
): GhostOccurrence[] {
  // 「이 묶음은 그날 이미 줄이 있다」를 빨리 보기 위한 표.
  const takenByGroup = new Map<string, Set<string>>();
  for (const t of tasks) {
    const key = dayKeyOf(t.due_at);
    if (!key) continue;
    const g = t.recurrence_group_id;
    if (!g) continue;
    const set = takenByGroup.get(g) ?? new Set<string>();
    set.add(key);
    takenByGroup.set(g, set);
  }

  const out: GhostOccurrence[] = [];
  for (const t of tasks) {
    if (!t.recurrence || t.archived_at) continue;
    // 픽업은 달력에서 막대로 안 그립니다(🚗 뱃지로 접힙니다). 예정도 마찬가지입니다.
    if (t.origin === "픽업") continue;
    const anchor = dayKeyOf(t.due_at);
    if (!anchor) continue;
    // **완료된 줄에서는 펼치지 않습니다.** 완료하면 그 자리에서 다음 회차가 진짜 줄로
    // 만들어지고, 그 줄이 다시 기준이 됩니다. 여기서도 펼치면 같은 날이 두 번 뜹니다.
    if (t.status === "완료") continue;

    const taken = t.recurrence_group_id ? takenByGroup.get(t.recurrence_group_id) : null;
    for (const day of occurrencesBetween(t.recurrence, anchor, fromKey, toKey)) {
      if (taken?.has(day)) continue;
      out.push({ task: t, dayKey: day });
    }
  }
  return out;
}
