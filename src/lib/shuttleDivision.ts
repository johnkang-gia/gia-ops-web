// 셔틀 배차표의 "반" 표기로 소속(유치부/초등부/중고등부)을 추정합니다.
//
// 2026BUS.pdf의 반 칸은 두 가지 형태로 적혀 있습니다:
//   - "5 Nightingale", "7 Albatross", "Pelican 4"  → 유치부 (나이 + 반이름)
//   - "학교"                                        → 초등부 (학교에 다니는 아이)
// 그 외(비어있거나 형식이 다른 경우)는 중고등부이거나 표기 누락일 수 있어 "미상"으로 둡니다.
//
// 이 구분이 필요한 이유: 지금 학생 명부에는 초등부만 등록되어 있어서, 유치부·중고등부 학생은
// 명부와 연결되지 않는 게 정상입니다. 전부 ⚠️로 표시하면 585명 중 488명에 경고가 떠서 정작
// 확인이 필요한 건(초등부인데 명부에 없는 학생)이 묻힙니다.
export type ShuttleDivision = "유치부" | "초등부" | "중고등부·미상";

export function divisionFromClassRaw(classRaw: string | null): ShuttleDivision {
  const c = (classRaw ?? "").trim();
  if (!c) return "중고등부·미상";
  if (c.includes("학교")) return "초등부";
  // 숫자와 영문 반이름이 함께 있으면 유치부(순서는 "5 Wren" / "Wren 5" 둘 다 쓰입니다).
  if (/\d/.test(c) && /[A-Za-z]{3,}/.test(c)) return "유치부";
  return "중고등부·미상";
}

// 명부 연결이 안 된 게 "진짜 확인이 필요한 건"인지 판단합니다.
// 초등부(=학교)인데 연결이 안 됐다면 표기 차이나 누락일 가능성이 높아 확인 대상입니다.
export function needsRosterAttention(classRaw: string | null, studentId: string | null): boolean {
  return !studentId && divisionFromClassRaw(classRaw) === "초등부";
}

export const DIVISION_BADGE: Record<ShuttleDivision, string> = {
  유치부: "bg-amber-50 text-amber-600",
  초등부: "bg-blue-50 text-blue-600",
  "중고등부·미상": "bg-slate-100 text-slate-500",
};
