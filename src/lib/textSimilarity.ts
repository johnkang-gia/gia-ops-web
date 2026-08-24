// 두 문장이 같은 얘기인지 가늠하기.
//
// 같은 일이 토들과 구글챗 두 경로로 들어오는데, 쓴 사람이 달라 문장은 전혀 다릅니다.
//
//   학부모(토들):  "선생님 안녕하세요. 유겸이가 어제부터 장염이라 오늘 결석하겠습니다."
//   담임(구글챗):  "@노유겸 결석 - 장염"
//
// 글자만 보면 겹치는 게 "유겸", "장염", "결석" 정도입니다. 그래서 문장 전체를 견주기보다,
// **어느 쪽에서든 빠지지 않는 낱말**이 얼마나 겹치는지를 봅니다. 짧은 쪽을 기준으로 삼는
// 것이 핵심입니다 - 긴 인사말이 붙었다고 다른 일이 되는 건 아니니까요.

/** 견주기 전에 지워도 되는 것들. 있으나 없으나 뜻이 같은 말들입니다. */
const NOISE = [
  "안녕하세요",
  "감사합니다",
  "수고하세요",
  "죄송합니다",
  "선생님",
  "어머님",
  "아버님",
  "학부모님",
  "부탁드립니다",
  "말씀",
  "드립니다",
  "습니다",
  "합니다",
  "해요",
  "네요",
  "please",
  "thank",
  "thanks",
  "hello",
  "hi",
];

/**
 * 견주기 좋게 다듬습니다.
 * - 문장부호·이모지·공백을 없애고
 * - 영문은 소문자로
 * - 인사말 같은 상투적인 말은 지웁니다
 */
export function normalizeForCompare(text: string): string {
  let t = (text ?? "").toLowerCase();
  // @멘션, 괄호 안 별명 등은 견줄 때 방해가 됩니다.
  t = t.replace(/@[^\s]+/g, " ");
  t = t.replace(/[（(][^）)]*[）)]/g, " ");
  for (const w of NOISE) t = t.split(w).join(" ");
  // 한글·영문·숫자만 남깁니다.
  t = t.replace(/[^가-힣a-z0-9]/g, "");
  return t;
}

/** 글자 두 개씩 끊어 만든 조각들. 한국어는 띄어쓰기가 들쭉날쭉해 낱말보다 이쪽이 안정적입니다. */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length === 1) out.add(s);
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 0~1 사이의 닮은 정도.
 *
 * 겹치는 조각 수를 **짧은 쪽** 크기로 나눕니다(자카드가 아니라 포함도에 가깝습니다).
 * 학부모의 긴 문장 안에 담임의 짧은 메모가 통째로 들어 있는 모양이 흔한데, 자카드로 재면
 * 길이 차이 때문에 값이 낮게 나와 같은 건을 놓칩니다.
 */
export function similarity(a: string, b: string): number {
  const x = bigrams(normalizeForCompare(a));
  const y = bigrams(normalizeForCompare(b));
  if (x.size === 0 || y.size === 0) return 0;
  let hit = 0;
  for (const g of x) if (y.has(g)) hit += 1;
  return hit / Math.min(x.size, y.size);
}

/**
 * 학생 이름·날짜처럼 "같은 건이라면 반드시 겹쳐야 하는" 낱말이 겹치는지.
 *
 * 닮은 정도만으로는 "오늘 결석합니다"와 "오늘 지각합니다"를 못 가릅니다. 둘 다 짧고 대부분
 * 겹치기 때문입니다. 그래서 뜻이 갈리는 낱말이 서로 어긋나면 다른 건으로 봅니다.
 */
const CONFLICT_GROUPS = [
  ["결석", "absent"],
  ["지각", "late"],
  ["조퇴", "early"],
  ["픽업", "데리러", "데려", "pickup", "pick up"],
];

export function hasConflictingIntent(a: string, b: string): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  const inA = CONFLICT_GROUPS.map((g) => g.some((w) => na.includes(normalizeForCompare(w))));
  const inB = CONFLICT_GROUPS.map((g) => g.some((w) => nb.includes(normalizeForCompare(w))));
  // 한쪽에만 뚜렷하게 있는 뜻이 서로 다르면 다른 건입니다.
  for (let i = 0; i < CONFLICT_GROUPS.length; i++) {
    for (let j = 0; j < CONFLICT_GROUPS.length; j++) {
      if (i === j) continue;
      if (inA[i] && !inA[j] && inB[j] && !inB[i]) return true;
    }
  }
  return false;
}
