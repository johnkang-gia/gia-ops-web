// 학기/캠프 구분값 - terms 테이블(학기 관리), 신청서 템플릿(form_import_templates, 신청서 탭),
// 학기준비 화면에서 공통으로 씁니다. 여러 화면에서 각자 목록을 만들면 표기가 미묘하게 어긋나서
// (예: "여름캠프1" vs "여름 캠프1") 같은 학기를 못 찾는 문제가 생기므로 한 곳에서 관리합니다
// (요청: "같은 데이터는 통합관리를 해서 검색이나 색인이 쉽게 하고 싶어").
export const TERM_TYPES = ["1학기", "2학기", "3학기", "여름캠프1", "여름캠프2", "겨울캠프1", "겨울캠프2"];

/**
 * 학기 종류를 **성격으로** 묶습니다.
 *
 * 정규학기와 캠프는 하는 일이 전혀 다릅니다 - 정규학기는 반배정·시간표·교과서이고,
 * 캠프는 모집 공고·신청서 마감·캠프 안내문입니다. 학사일정 규칙을 만들 때 일곱 개를
 * 하나씩 고르게 하면 매번 같은 조합을 손으로 다시 만들게 되므로, 묶음을 미리 둡니다.
 */
export const TERM_GROUPS: { label: string; hint: string; types: string[] }[] = [
  { label: "정규학기", hint: "1·2·3학기", types: ["1학기", "2학기", "3학기"] },
  { label: "캠프", hint: "여름·겨울 캠프 전부", types: ["여름캠프1", "여름캠프2", "겨울캠프1", "겨울캠프2"] },
  { label: "여름캠프", hint: "여름캠프1·2", types: ["여름캠프1", "여름캠프2"] },
  { label: "겨울캠프", hint: "겨울캠프1·2", types: ["겨울캠프1", "겨울캠프2"] },
];

/**
 * 이 규칙이 그 학기에 적용되는가.
 *
 * **비어 있으면 모든 학기입니다.** 예전에 만들어 둔 규칙(적용 범위를 안 적은 것)이 어느
 * 날 갑자기 안 도는 일이 없어야 합니다 - 안 도는 것은 오류로 안 보이고, 그 학기가 다
 * 지나간 뒤에야 「그거 왜 안 올라왔지」로 발견됩니다.
 */
export function appliesToTerm(scope: string[] | null | undefined, termType: string | null | undefined): boolean {
  if (!scope || scope.length === 0) return true;
  if (!termType) return false;
  return scope.includes(termType);
}

/** 적용 범위를 사람 말로. 묶음과 딱 맞으면 묶음 이름으로 짧게 적습니다. */
export function describeTermScope(scope: string[] | null | undefined): string {
  if (!scope || scope.length === 0) return "모든 학기";
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  for (const g of TERM_GROUPS) if (same(scope, g.types)) return g.label;
  if (same(scope, TERM_TYPES)) return "모든 학기";
  return scope.join(" · ");
}
