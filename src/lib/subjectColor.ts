// 과목 색.
//
// 담당자: "시간표 안에 과목들 색이 달랐으면 좋겠어. 일단 알아서 과목별로 색을 지정해주고,
//         그 색을 자유롭게 바꿀 수도 있도록."
//
// 두 단계입니다.
//   1. **자동** - 과목 이름을 섞어(hash) 팔레트에서 하나 고릅니다. 아무 설정도 없이 바로
//      과목마다 다른 색이 나오고, 같은 과목은 어느 화면에서든 늘 같은 색입니다.
//   2. **덮어쓰기** - 자동 색이 마음에 안 들면 wr_subject_colors에 적어둡니다.
//
// 왜 무작위가 아니라 hash인가: 무작위면 새로고침할 때마다 색이 바뀝니다. 시간표에서 색의
// 쓸모는 "저 초록색이 늘 영어"라는 데 있는데, 매번 달라지면 아무 쓸모가 없습니다.

/** 시간표 칸에 쓸 색 한 벌. 글자가 배경 위에서 읽혀야 하므로 짝으로 정합니다. */
export type SubjectColor = {
  /** 칸 배경 */
  bg: string;
  /** 과목 이름 글자 */
  fg: string;
  /** 선생님·교실 등 곁들이는 글자(조금 흐리게) */
  sub: string;
  /** 목록·점 표시에 쓰는 진한 색 */
  dot: string;
};

// 파스텔 12색. 시간표는 칸이 작고 빽빽해서 진한 배경을 쓰면 글자가 안 읽힙니다.
// 배경은 옅게, 글자는 같은 계열의 진한 색으로 짝지었습니다.
export const SUBJECT_PALETTE: SubjectColor[] = [
  { bg: "#EEF2FF", fg: "#3730A3", sub: "#6366F1", dot: "#4F46E5" }, // 남보라
  { bg: "#ECFDF5", fg: "#065F46", sub: "#10B981", dot: "#059669" }, // 초록
  { bg: "#FEF3C7", fg: "#92400E", sub: "#D97706", dot: "#D97706" }, // 노랑
  { bg: "#FCE7F3", fg: "#9D174D", sub: "#EC4899", dot: "#DB2777" }, // 분홍
  { bg: "#E0F2FE", fg: "#075985", sub: "#0EA5E9", dot: "#0284C7" }, // 하늘
  { bg: "#F3E8FF", fg: "#6B21A8", sub: "#A855F7", dot: "#9333EA" }, // 보라
  { bg: "#FFEDD5", fg: "#9A3412", sub: "#F97316", dot: "#EA580C" }, // 주황
  { bg: "#CCFBF1", fg: "#115E59", sub: "#14B8A6", dot: "#0D9488" }, // 청록
  { bg: "#FEE2E2", fg: "#991B1B", sub: "#EF4444", dot: "#DC2626" }, // 빨강
  { bg: "#ECFCCB", fg: "#3F6212", sub: "#84CC16", dot: "#65A30D" }, // 연두
  { bg: "#E0E7FF", fg: "#3730A3", sub: "#818CF8", dot: "#6366F1" }, // 연보라
  { bg: "#F1F5F9", fg: "#334155", sub: "#64748B", dot: "#475569" }, // 회색
];

/** 이름을 숫자로 섞습니다. 같은 이름은 늘 같은 숫자가 나옵니다(djb2). */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 과목 이름만으로 정해지는 자동 색. 설정이 없어도 이게 나옵니다. */
export function autoSubjectColor(name: string): SubjectColor {
  const key = (name ?? "").trim();
  if (!key) return SUBJECT_PALETTE[SUBJECT_PALETTE.length - 1];
  return SUBJECT_PALETTE[hash(key) % SUBJECT_PALETTE.length];
}

/**
 * 덮어쓴 색(팔레트 번호)이 있으면 그것을, 없으면 자동 색을 줍니다.
 * overrides의 값은 팔레트 번호("0"~"11") 또는 직접 적은 색(#RRGGBB) 둘 다 받습니다.
 */
export function subjectColor(name: string, overrides: Record<string, string> | undefined): SubjectColor {
  const set = overrides?.[(name ?? "").trim()];
  if (!set) return autoSubjectColor(name);
  const idx = Number(set);
  if (Number.isInteger(idx) && idx >= 0 && idx < SUBJECT_PALETTE.length) return SUBJECT_PALETTE[idx];
  // 직접 적은 색. 배경만 바꾸고 글자는 검정 계열로 둡니다 - 어떤 색을 넣어도 읽히게 하려면
  // 이게 가장 안전합니다(밝기를 계산해 흑백을 고르는 것보다 결과가 예측 가능합니다).
  if (/^#[0-9a-fA-F]{6}$/.test(set)) return { bg: set, fg: "#1E293B", sub: "#475569", dot: set };
  return autoSubjectColor(name);
}
