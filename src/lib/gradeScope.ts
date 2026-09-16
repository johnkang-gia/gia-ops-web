/**
 * **부서 안에서 학년 → 반으로 좁혀 보기** — 목록과 판정은 여기 한 곳입니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 부서 하나가 100명이 넘어 한 화면에 안 들어옵니다. 그런데 학비를 정하거나 항목을 붙이는
 * 일은 대개 **한 학년씩** 또는 **한 반씩** 훑으며 합니다. 청구(학비)에는 좁히는 길이 아예
 * 없어 검색칸에 반 이름을 쳐야 했고, 학비외에는 반 열다섯 개가 한 줄에 **평평하게** 서서
 * 「2학년을 통째로」 보는 길이 묻혀 있었습니다.
 *
 * ── 어떻게 ─────────────────────────────────────────────────────────────────
 *
 * 부서 → 학년 → 반, 위에서 아래로 한 단씩입니다. 각 단에 **전체**가 먼저 서서, 한 단 내려간
 * 사람이 돌아올 길을 잃지 않습니다.
 *
 * 목록은 **명부에 실제로 있는 것**에서 만듭니다. 손으로 적어두면 학년이 늘거나 빌 때 어긋나고,
 * 빈 학년 단추는 눌러도 아무도 안 나오는 화면이 됩니다 - 그건 오류가 아니라 「학생이 없다」로
 * 읽힙니다.
 *
 * 순수 함수입니다 - 화면 없이 시험할 수 있습니다.
 */

export type ScopeStudent = { grade: string | null; className: string | null };

/** 빈 글자가 「전체」입니다. 따로 «전체» 라는 값을 두지 않는 이유는, 그 값이 실제 학년 이름과 섞일 수 있어서입니다. */
export type Scope = { grade: string; klass: string };

export const ALL_SCOPE: Scope = { grade: "", klass: "" };

export function gradesIn(list: ScopeStudent[], sortKey: (g: string) => number): string[] {
  const set = new Set<string>();
  for (const s of list) if (s.grade?.trim()) set.add(s.grade.trim());
  return [...set].sort((a, b) => sortKey(a) - sortKey(b));
}

/** 그 학년 안의 반. 학년을 안 골랐으면 **빈 목록**입니다 - 반을 전부 펼치면 학년이 묻힙니다. */
export function classesIn(list: ScopeStudent[], grade: string): string[] {
  if (!grade) return [];
  const set = new Set<string>();
  for (const s of list) {
    if ((s.grade ?? "").trim() !== grade) continue;
    if (s.className?.trim()) set.add(s.className.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

/**
 * 반 이름 하나가 어느 학년인가.
 *
 * 예전에 반만 골라두던 화면을 학년→반 두 단으로 바꾸면서, **반만 아는 상태에서 학년 줄을
 * 켜 줘야** 합니다. 이름 규칙(G2A → 2학년)으로 짐작하지 않고 명부에서 찾습니다 - 반 이름
 * 규칙은 학교가 바꾸면 그날로 어긋나고, 어긋난 것은 화면에 오류로 안 보입니다.
 */
export function gradeOfClass(list: ScopeStudent[], klass: string): string {
  for (const s of list) if ((s.className ?? "").trim() === klass && s.grade?.trim()) return s.grade.trim();
  return "";
}

export function inScope(s: ScopeStudent, scope: Scope): boolean {
  if (scope.grade && (s.grade ?? "").trim() !== scope.grade) return false;
  if (scope.klass && (s.className ?? "").trim() !== scope.klass) return false;
  return true;
}

/**
 * 지금 무엇을 보고 있는지 한 마디로. 화면이 명단 위에 적고, 내려받는 파일 이름에도 씁니다.
 *
 * 「전체」라고만 적으면 어느 부서의 전체인지 모릅니다 - 내려받은 파일이 셋 쌓이면 어느 것이
 * 무엇인지 구별할 수 없게 됩니다.
 */
export function scopeLabel(dept: string, scope: Scope): string {
  if (scope.klass) return scope.klass;
  if (scope.grade) return `${dept} ${scope.grade}`;
  return `${dept} 전체`;
}

/**
 * 좁혀둔 것이 **없는 자리를 가리키면** 풀어줍니다.
 *
 * 초등부 2학년을 보다가 중고등부로 옮기면 2학년은 그쪽에 없습니다. 그대로 두면 빈 표가
 * 뜨는데, 화면에는 오류가 아니라 「그 부서에 학생이 없다」로 보입니다.
 */
export function fixScope(scope: Scope, grades: string[], classes: string[]): Scope {
  if (scope.grade && !grades.includes(scope.grade)) return ALL_SCOPE;
  if (scope.klass && !classes.includes(scope.klass)) return { grade: scope.grade, klass: "" };
  return scope;
}
