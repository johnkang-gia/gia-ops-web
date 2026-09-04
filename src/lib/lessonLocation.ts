// 지금 그 반이 어디에 있는지.
//
// 처음에는 특수교실을 «교실 밖»으로만 뭉뚱그려 표시했습니다. 어디인지 확실하지 않은데
// 방 이름을 말했다가 찾으러 나간 사람이 헛걸음할까 봐 조심한 것이었습니다.
//
// 그런데 실제로는 특수교실이 셋뿐이고, 시간표의 강의실 칸이 비어 있는 수업은 그 셋 중
// 하나입니다. 학교에서 부르는 이름도 이미 정해져 있습니다 — **ART · GYM · COM**.
// «교실 밖»은 그 셋을 다 알면서 일부러 안 알려주는 표시였고, 결국 사람이 한 번 더
// 물어보게 만들었습니다.
//
//   - special: 교실이 아닌 곳인지. 색으로 구분할 때 씁니다.
//   - room: 부르는 이름 그대로. 화면에 이대로 나갑니다.
//
// 판단은 과목 이름으로 합니다. 학교마다 표기가 제각각이라(PE / P.E. / Physical Education /
// 체육) 넉넉하게 잡았습니다. 못 알아본 과목은 교실에 있는 것으로 봅니다 - 확실하지 않은데
// 특수교실이라고 하면 찾으러 나갔다가 헛걸음합니다.

export type LessonPlace = {
  /** 교실이 아닌 곳에 있는지. */
  special: boolean;
  /** 부르는 이름(ART · GYM · COM · MUS). special이 false면 null입니다. */
  room: string | null;
};

const RULES: { room: string; patterns: RegExp[] }[] = [
  {
    room: "GYM",
    patterns: [/\bp\.?\s?e\.?\b/i, /physical\s*education/i, /^체육/, /\bsports?\b/i, /\bgym/i],
  },
  {
    room: "COM",
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
    // 학교가 이름을 정해준 것은 ART·GYM·COM 셋입니다. 음악은 시간표에 나오기는 해서
    // 같은 꼴로 MUS 를 붙여 뒀습니다 - 다르게 부르신다면 이 한 줄만 고치면 됩니다.
    room: "MUS",
    patterns: [/\bmusic\b/i, /^음악/, /\bband\b/i, /\bchoir\b/i, /\borchestra\b/i],
  },
  {
    room: "ART",
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
