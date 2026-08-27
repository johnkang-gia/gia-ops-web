// 셔틀 학기 구분.
//
// 담당자: "노선 배차표도 여름캠프 차량이 그대로 있어. 셔틀도 정규학기와 여름캠프로 자료를
//          나누고 구분해서 저장되도록 만들어줘. 학기는 기록이 유지되는데 차량이 유지가
//          안 되면 안 되니까."
//
// 맞는 지적입니다. 지난 학기 노선을 **지우면 안 됩니다** - 그때 누가 몇 호차를 탔는지,
// 몇 시에 어느 정류장에 섰는지가 전부 그 노선에 매달려 있습니다. 지우는 순간 지난 학기
// 기록이 통째로 미아가 됩니다.
//
// 그래서 지우지 않고 **갈라서 봅니다.** shuttle_routes.term이 이미 그 역할을 하고 있었는데,
// 화면 몇 곳이 그 칸을 안 보고 전부 불러오고 있었습니다(배차표·지역별·노선관리·탑승배정).
// 같은 자료를 화면마다 다르게 보고 있었던 셈이고, 그래서 "27호가 왜 두 개지?"가 됐습니다.

export const SHUTTLE_TERMS = ["정규학기", "여름캠프2"] as const;
export type ShuttleTerm = (typeof SHUTTLE_TERMS)[number];

/** 지금 운영 중인 학기. 새 노선을 만들 때도 이 값이 붙습니다. */
export const CURRENT_SHUTTLE_TERM: ShuttleTerm = "정규학기";

/** 주소창의 ?term= 값을 안전하게 학기로 바꿉니다. 모르는 값이면 현재 학기. */
export function parseShuttleTerm(raw: string | undefined | null): ShuttleTerm {
  return (SHUTTLE_TERMS as readonly string[]).includes(raw ?? "") ? (raw as ShuttleTerm) : CURRENT_SHUTTLE_TERM;
}

/** 지난 학기를 보고 있는가(= 고치면 안 되는 기록인가). */
export function isPastTerm(term: ShuttleTerm): boolean {
  return term !== CURRENT_SHUTTLE_TERM;
}
