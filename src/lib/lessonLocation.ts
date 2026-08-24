// 지금 그 반이 어디에 있는지.
//
// 요청: "위치도 알 수 있게 표시해줘. 교실이면 교실, pe면 gym, 컴퓨터사이언스나 코딩이면
// 컴퓨터실, 뮤직은 음악실, ART는 미술실이야. 일단 특수교실들은 장소를 바로 표시하지말고,
// 그냥 교실이 아닌곳에 있다는 표시만 해줬으면 좋겠어"
//
// 그래서 두 가지를 나눠 둡니다.
//   - special: 교실 밖으로 나갔는지 여부. 화면에는 이것만 씁니다.
//   - room: 실제로 어느 방인지. 지금은 화면에 안 쓰지만, 나중에 켜기만 하면 되도록 계산은
//     해둡니다. 아이를 찾아야 할 때 결국 필요해질 정보라 미리 준비해 둡니다.
//
// 판단은 과목 이름으로 합니다. 학교마다 과목 표기가 제각각이라(PE / P.E. / Physical
// Education / 체육) 넉넉하게 잡았습니다. 못 알아본 과목은 교실에 있는 것으로 봅니다 -
// 확실하지 않은데 "교실 밖"이라고 하면 찾으러 나갔다가 헛걸음합니다.

export type LessonPlace = {
  /** 교실이 아닌 곳에 있는지. */
  special: boolean;
  /** 실제 장소. special이 false면 null입니다. */
  room: string | null;
};

const RULES: { room: string; patterns: RegExp[] }[] = [
  {
    room: "체육관",
    patterns: [/\bp\.?\s?e\.?\b/i, /physical\s*education/i, /^체육/, /\bsports?\b/i, /\bgym/i],
  },
  {
    room: "컴퓨터실",
    patterns: [
      /computer\s*science/i,
      /\bcoding\b/i,
      /\bcomputing\b/i,
      /\bict\b/i,
      /\bcs\b/i,
      /컴퓨터/,
      /코딩/,
      /정보/,
    ],
  },
  {
    room: "음악실",
    patterns: [/\bmusic\b/i, /^음악/, /\bband\b/i, /\bchoir\b/i, /\borchestra\b/i],
  },
  {
    room: "미술실",
    patterns: [/\bart\b/i, /^미술/, /\bvisual\s*arts?\b/i, /\bdrawing\b/i],
  },
];

/**
 * 과목 이름을 보고 어디에 있는지 판단합니다.
 *
 * 못 알아본 과목은 교실로 봅니다. 확실하지 않은데 "교실 밖"이라고 하면 찾으러 나갔다가
 * 헛걸음하게 되고, 그러면 이 표시를 아무도 안 믿게 됩니다.
 */
export function lessonPlace(subjectName: string | null | undefined): LessonPlace {
  const name = (subjectName ?? "").trim();
  if (!name) return { special: false, room: null };
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(name))) return { special: true, room: rule.room };
  }
  return { special: false, room: null };
}
