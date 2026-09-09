/**
 * **가지러 오는 대상이 아이인가, 물건인가.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 실제로 자동 등록됐던 글입니다.
 *
 *   "오늘 예온이 자가 등원을 하면서 오피스에서 첼로를 픽업하려고 합니다!
 *    8시 10분쯤 도착할 것 같은데 오피스로 가면 될까요?"
 *
 * 가지러 오는 것은 **첼로**이고, 아이는 오히려 **등원**하는 중입니다. 그런데 「픽업」이라는
 * 낱말과 시각이 함께 있어서 하원 픽업으로 잡혔고, 그 아이는 오후에 셔틀 명단에서 빠졌습니다.
 *
 * AI 프롬프트에는 이미 「첼로 가지러 오피스로 갈게요 → 픽업 아님」이 예시로 적혀 있습니다.
 * **적어두는 것만으로는 안 됩니다.** 같은 종류의 문장은 계속 다르게 오고, 그때마다 AI가
 * 맞기를 바라야 합니다. 틀리면 아이가 차를 못 탑니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 규칙으로 한 겹 더 겁니다. 여기 걸리면 **자동 확정을 막고 사람에게 넘깁니다.** 픽업이
 * 아니라고 단정하지는 않습니다 - 단정은 AI가 하고, 여기서는 「혼자 정하지 마라」고만 합니다.
 * 사람이 한 번 더 보는 비용은 작고, 아이가 잘못 빠지는 비용은 되돌릴 수 없습니다.
 */

/** 가지러 올 만한 물건들. 학교에 두고 가는 것들입니다. */
const OBJECT =
  /첼로|바이올린|비올라|플루트|클라리넷|트럼펫|피아노|기타|우쿨렐레|악기|가방|책가방|도시락|물통|우산|책|교재|워크북|서류|물건|준비물|체육복|수영복|신발|실내화|점퍼|외투|패딩|약봉지|핸드폰|휴대폰|지갑|열쇠|노트북|태블릿|cello|violin|instrument|bag|lunch\s*box|umbrella|book|jacket|laptop/i;

/** 「가지러 간다」에 해당하는 말. */
const FETCH = /가지러|찾으러|가져가|가져오|가져다|받으러|찾아가|픽업|pick\s*(?:it|them)?\s*up|collect|drop\s*off/i;

/**
 * **아이를 데려간다**는 말. 이게 있으면 물건 이야기가 섞여 있어도 진짜 픽업입니다.
 *
 * "첼로도 챙겨서 아이 데리고 갈게요" 같은 글이 실제로 옵니다.
 */
const CHILD_TAKEN =
  /데리러|데려가|데려갈|데려오|데리고\s*가|하원\s*시(?:키|켜)|조퇴|일찍\s*(?:하원|데)|early\s*(?:dismissal|pick)|take\s+(?:him|her|my\s+(?:son|daughter|child))/i;

/** 아이가 학교로 **오는** 중이라는 말. 하원의 반대라 픽업일 수 없습니다. */
const ARRIVING = /등원|등교|자가\s*등원|도착할\s*것|도착합니다|도착\s*예정|arriv|coming\s+to\s+school|drop\s+(?:him|her)\s+off/i;

/**
 * 자동 확정을 막아야 하는 글인가.
 *
 * 두 갈래 중 하나라도 걸리면 사람이 봅니다.
 *   ① 물건을 가지러 오는데 아이를 데려간다는 말이 없다
 *   ② 아이가 **등원**하는 이야기인데 데려간다는 말이 없다
 */
export function looksLikeObjectPickup(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  // 아이를 데려간다고 분명히 적혀 있으면 진짜 픽업입니다. 물건은 곁다리입니다.
  if (CHILD_TAKEN.test(t)) return false;
  if (OBJECT.test(t) && FETCH.test(t)) return true;
  if (ARRIVING.test(t)) return true;
  return false;
}

/** 왜 사람에게 넘겼는지 인박스에 적을 한 줄. 이유 없는 「확인 필요」는 아무도 안 봅니다. */
export function objectPickupNote(text: string): string | null {
  const t = String(text ?? "");
  if (CHILD_TAKEN.test(t)) return null;
  if (OBJECT.test(t) && FETCH.test(t)) {
    const what = t.match(OBJECT)?.[0] ?? "물건";
    return `가지러 오는 대상이 «${what}»으로 보입니다. 아이를 데려간다는 말이 없어 자동 확정하지 않았습니다.`;
  }
  if (ARRIVING.test(t)) return "아이가 학교로 오는(등원) 이야기로 보입니다. 하원 픽업이 아닐 수 있어 자동 확정하지 않았습니다.";
  return null;
}
