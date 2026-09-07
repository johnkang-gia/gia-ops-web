/**
 * 학부모 문의의 분류.
 *
 * 원래는 수집 단계에서 AI가 `inquiry_type` 에 적어 둡니다. 그런데 **비어 있는 줄이 있습니다** —
 * 분류 칸이 생기기 전에 들어온 글, AI가 정해진 갈래 밖의 값을 돌려준 글, 수집기가 분류를
 * 건너뛴 글. 대시보드는 분류가 없으면 이름만 띄웠고, 그래서 화면에는 「고서윤」만 뜹니다.
 * 멀리서 보는 사람에게 이름만 있는 줄은 «뭔가 왔다»는 것 말고는 아무것도 알려주지 않습니다.
 *
 * 그래서 비어 있을 때만 글에서 짐작합니다. **AI가 적어둔 값이 있으면 절대 덮어쓰지 않습니다** —
 * 사람·기계가 이미 정한 것을 나중 규칙이 뒤집으면, 화면과 업무보드가 서로 다른 말을 합니다.
 */

export const INQUIRY_TYPES = [
  "출결",
  "수업·학습",
  "생활·교우",
  "건강·안전",
  "차량·하원",
  "행사·일정",
  "납부·행정",
  "기타",
] as const;

export type InquiryType = (typeof INQUIRY_TYPES)[number];

/**
 * 갈래마다 «그 말이 나오면 그 갈래»인 낱말들.
 *
 * 순서가 곧 우선순위입니다. 한 글에 여러 갈래가 섞이면(“열이 나서 오늘 결석합니다”) 위에
 * 있는 갈래로 갑니다. 행정실이 먼저 손대야 하는 순서 — 출결·차량이 위, 안내성 이야기가
 * 아래입니다.
 */
const RULES: { type: InquiryType; words: string[] }[] = [
  {
    type: "출결",
    words: [
      "결석", "지각", "조퇴", "등원", "안 가", "안가요", "못 가", "못가요", "늦게", "늦어",
      "absent", "late", "sick day", "won't be", "will not be", "miss school",
    ],
  },
  {
    type: "차량·하원",
    words: [
      "픽업", "하원", "셔틀", "버스", "차량", "정류장", "태워", "데리러", "데려",
      "pick up", "pickup", "shuttle", "bus", "ride",
    ],
  },
  {
    type: "건강·안전",
    words: [
      "아파", "아픈", "아픕", "열이", "고열", "미열", "감기", "독감", "병원", "약을", "투약",
      "알레르기", "다쳤", "다침", "코로나", "장염", "복통", "두통",
      "fever", "sick", "medicine", "allergy", "hospital", "injur",
    ],
  },
  {
    type: "납부·행정",
    words: [
      "학비", "납부", "결제", "청구", "고지서", "환불", "영수증", "증명서", "서류", "계좌",
      "입금", "카드", "올톡", "invoice", "payment", "refund", "receipt", "tuition",
    ],
  },
  {
    type: "행사·일정",
    words: [
      "행사", "일정", "소풍", "현장학습", "캠프", "발표회", "공연", "운동회", "상담일",
      "방학", "개학", "졸업", "입학", "설명회",
      "event", "field trip", "schedule", "holiday", "vacation",
    ],
  },
  {
    type: "수업·학습",
    words: [
      "숙제", "과제", "수업", "교재", "교과서", "시험", "성적", "리포트", "학습", "준비물",
      "수학", "영어", "독서",
      "homework", "assignment", "class", "textbook", "exam", "grade", "study",
    ],
  },
  {
    type: "생활·교우",
    words: [
      "친구", "다툼", "싸웠", "따돌", "괴롭", "교우", "생활", "태도", "분실", "잃어버",
      "friend", "fight", "bully", "lost",
    ],
  },
];

/**
 * 글에서 분류를 짐작합니다. 짐작할 수 없으면 null — 「기타」로 자동으로 떨어뜨리지 않습니다.
 * 부르는 쪽이 «못 정했다»와 «기타로 정했다»를 구별할 수 있어야 합니다.
 */
export function guessInquiryType(text: string | null | undefined): InquiryType | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  for (const r of RULES) {
    if (r.words.some((w) => t.includes(w))) return r.type;
  }
  return null;
}

/**
 * 화면에 적을 분류 한 글자씩.
 *
 * 저장된 값이 있으면 그대로. 없을 때만 짐작하고, 짐작도 안 되면 「기타」입니다.
 * 짐작한 것인지는 두 번째 값으로 알려줍니다 - 화면에서 확실한 것과 구별해 표시할 수 있게.
 */
export function displayInquiryType(
  stored: string | null | undefined,
  text: string | null | undefined
): { label: string; guessed: boolean } {
  const s = (stored ?? "").trim();
  if (s) return { label: s, guessed: false };
  const g = guessInquiryType(text);
  return { label: g ?? "기타", guessed: true };
}
