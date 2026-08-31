// "매주 금요일" 같은 **반복** 표현을 문장에서 직접 읽어냅니다.
//
// 담당자: "@John Kang @Paul Lee @Rachel Bailey Theo is pick up everyfriday 3:10! 이걸 킴태오
//          픽업으로 만들었더라고. everyfriday 매주 금요일인데 이 부분을 무시하고 그냥 태오
//          픽업으로 넣어버렸어."
//
// **왜 AI에게만 맡기면 안 되는가:** 반복 판정은 AI 프롬프트에 이미 규칙이 있었습니다. 그런데
// 이 문장에서는 안 잡혔습니다 - 'everyfriday'처럼 띄어쓰기가 없거나, 영어와 한국어가 섞이거나,
// 앞에 멘션이 길게 붙으면 모델이 놓칠 수 있습니다. 그리고 놓쳤을 때의 결과가 조용합니다.
// 오늘 하루 픽업으로 잘 들어간 것처럼 보이고, **다음 주 금요일에 아이가 그냥 차를 탑니다.**
//
// 그래서 규칙으로 한 번 더 봅니다. 규칙은 모델보다 덜 똑똑하지만 **같은 문장에 늘 같은 답**을
// 냅니다. 둘 중 하나라도 반복이라고 하면 반복으로 봅니다 - 반복을 한 번짜리로 잘못 보는 쪽이
// 한 번짜리를 반복으로 잘못 보는 쪽보다 훨씬 위험합니다(전자는 아이가 차에 타버립니다).

/** 1=월 … 5=금. 셔틀은 평일만 다니므로 토·일은 버립니다. */
export type Weekday = 1 | 2 | 3 | 4 | 5;

const KO_TO_NUM: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

// 긴 것부터 적어야 'fri'가 'friday'를 가로채지 않습니다.
const EN_DAYS: [RegExp, number][] = [
  [/monday|mondays|mon\b|mon(?=day)?/, 1],
  [/tuesday|tuesdays|tues|tue\b/, 2],
  [/wednesday|wednesdays|weds|wed\b/, 3],
  [/thursday|thursdays|thurs|thur|thu\b/, 4],
  [/friday|fridays|fri\b/, 5],
  [/saturday|saturdays|sat\b/, 6],
  [/sunday|sundays|sun\b/, 7],
];

const EN_DAY_ALTERNATION =
  "mondays|monday|mon|tuesdays|tuesday|tues|tue|wednesdays|wednesday|weds|wed|thursdays|thursday|thurs|thur|thu|fridays|friday|fri|saturdays|saturday|sat|sundays|sunday|sun";

function enDayToNum(word: string): number | null {
  for (const [re, n] of EN_DAYS) if (new RegExp(`^(?:${re.source})$`).test(word)) return n;
  return null;
}

/**
 * 문장에서 반복 요일을 뽑습니다. 반복 표현이 없으면 **빈 배열**입니다.
 *
 * 평일(월~금)만 돌려줍니다 - 셔틀이 평일만 다니므로 토·일 반복은 셔틀 배정에 쓸 데가
 * 없습니다. 다만 "매주 토요일"을 반복으로 **인식은** 하므로, 반복인지 아닌지를 알고 싶으면
 * `hasRecurringPhrase`를 함께 보세요.
 */
export function extractRecurringWeekdays(text: string): Weekday[] {
  const raw = (text ?? "").toLowerCase();
  if (!raw.trim()) return [];
  const found = new Set<number>();

  // ── 매일 / every day ────────────────────────────────────────────────────────
  // 붙여 쓴 'everyday'까지 잡으려고 공백을 없앤 판을 따로 씁니다.
  const compact = raw.replace(/[\s·,./|+&-]/g, "");
  if (/매일|평일내내|everyday|daily|everyweekday/.test(compact)) {
    return [1, 2, 3, 4, 5];
  }

  // ── 영어: every friday / everyfriday / each friday / weekly on friday / fridays ──
  for (const m of compact.matchAll(new RegExp(`(?:every|each|weeklyon|everyweekon)(${EN_DAY_ALTERNATION})`, "g"))) {
    const n = enDayToNum(m[1]);
    if (n) found.add(n);
  }
  // 복수형 단독("she is picked up fridays")도 반복입니다.
  for (const m of raw.matchAll(/\b(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/g)) {
    const n = enDayToNum(m[1]);
    if (n) found.add(n);
  }

  // ── 한국어: 매주 X요일 / 매 X요일 / X요일마다 ─────────────────────────────
  //
  // '매주' 뒤 25자 안에서만 요일을 찾습니다. 문장 전체를 훑으면 "매주 금요일 픽업이고,
  // 다음주 월요일은 결석입니다"에서 월요일까지 반복으로 딸려 들어옵니다.
  for (const m of raw.matchAll(/매\s*주/g)) {
    // 창은 20자, 그나마도 **문장이 끊기는 자리에서 자릅니다.**
    // "매주 금요일 픽업이고, 다음주 월요일은 결석입니다"에서 창만 길면 뒤 문장의 월요일까지
    // 반복으로 딸려 들어옵니다 - 쉼표나 '다음주' 같은 말이 나오면 거기서 멈춥니다.
    const window = raw
      .slice(m.index + m[0].length, m.index + m[0].length + 20)
      .split(/[,.\n。!?;]|다음\s*주|이번\s*주|내일|모레|오늘/)[0];
    for (const d of window.matchAll(/[월화수목금토일](?=\s*요일|[\s·,/및와과]|$)/g)) {
      const n = KO_TO_NUM[d[0]];
      if (n) found.add(n);
    }
    // 영어 요일이 '매주' 뒤에 오는 섞인 문장("매주 friday")도 봅니다.
    for (const d of window.matchAll(new RegExp(`\\b(${EN_DAY_ALTERNATION})\\b`, "g"))) {
      const n = enDayToNum(d[1]);
      if (n) found.add(n);
    }
  }
  for (const m of raw.matchAll(/([월화수목금토일])\s*(?:요일)?\s*마다/g)) {
    const n = KO_TO_NUM[m[1]];
    if (n) found.add(n);
  }
  for (const m of raw.matchAll(/매\s*([월화수목금토일])\s*요일/g)) {
    const n = KO_TO_NUM[m[1]];
    if (n) found.add(n);
  }

  return [...found].filter((n): n is Weekday => n >= 1 && n <= 5).sort((a, b) => a - b);
}

/**
 * 반복을 뜻하는 말이 있었는지. 요일을 못 집어냈어도 **사람이 봐야 한다**는 신호입니다.
 *
 * "앞으로 계속 제가 데리러 갈게요"처럼 요일이 없는 반복도 있습니다. 이런 글을 하루짜리로
 * 처리하면 조용히 틀리므로, 요일을 못 읽었더라도 표시는 남겨야 합니다.
 */
export function hasRecurringPhrase(text: string): boolean {
  const raw = (text ?? "").toLowerCase();
  const compact = raw.replace(/[\s·,./|+&-]/g, "");
  return (
    /매주|매일|마다|앞으로계속|계속해서|당분간계속|정기적으로/.test(compact) ||
    /every|each\s|weekly|from\s*now\s*on|going\s*forward|permanently/.test(raw)
  );
}

/** [1,5] → "월·금" */
export function weekdayLabel(days: readonly number[]): string {
  const names = ["", "월", "화", "수", "목", "금", "토", "일"];
  return days.map((d) => names[d] ?? "?").join("·");
}
