import { ALL_SCOPE, departmentOf, departmentTabs } from "@/lib/department";

/**
 * **회계 범위** — 재무 화면 전체가 어느 부서의 돈을 보는가.
 *
 * ── 왜 화면 안의 탭이 아니라 범위인가 ─────────────────────────────────
 *
 * 초등부와 중고등부는 부서가 다르고 회계도 따로입니다. 예전에는 학비·학비외 화면 **안에서**
 * 「초등부 | 중고등부」 탭을 눌러 오갔습니다. 그러면 학비에서 중고등부를 보다가 학비외로
 * 넘어가면 다시 초등부가 떠 있었고, 미납·수납·월별 화면에는 그 탭조차 없어 두 부서의 돈이
 * 한 목록에 섞였습니다. 어느 부서의 장부를 보고 있는지가 화면마다 달랐습니다.
 *
 * 이제 범위는 재무 메뉴에서 **한 번** 고릅니다(전체 회계 · 초등 회계 · 중고등 회계). 고른
 * 범위는 재무 안의 모든 화면이 같이 따릅니다. 화면은 이 파일의 함수로만 범위를 읽습니다.
 *
 * 부서가 늘면(유치부) 이 파일은 안 고칩니다 - `VISIBLE_DEPARTMENTS` 에 이름을 넣으면 메뉴에
 * 「유치 회계」가 저절로 생깁니다.
 */

export const FINANCE_SCOPE_COOKIE = "gia_fin_scope";

/** 메뉴에 적는 이름. 「초등부」 → 「초등 회계」. */
export function scopeLabel(scope: string): string {
  if (scope === ALL_SCOPE) return "전체 회계";
  return `${scope.replace(/부$/, "")} 회계`;
}

/** 범위마다 색. 지금 어느 장부인지는 글자보다 색이 먼저 읽힙니다. */
export function scopeTone(scope: string): "slate" | "emerald" | "indigo" | "pink" {
  if (scope === "초등부") return "emerald";
  if (scope === "중고등부") return "indigo";
  if (scope === "유치부") return "pink";
  return "slate";
}

/**
 * 이 사람이 고를 수 있는 범위 — **재무 열쇠가 있으면 언제나 전부**(전체 · 초등 · 중고등).
 *
 * 처음에는 소속 부서를 따랐습니다(`departmentTabs`). 그런데 재무 담당은 소속이 초등부여도 두 부서의 돈을
 * 함께 맡습니다 - 초등부 소속 재무 담당에게 초등 회계만 열려 중고등 청구·수납이 아예 안 보였습니다.
 * 회계 범위는 «어느 부서 사람인가»가 아니라 «재무를 맡았는가»로 정합니다. 열쇠가 없는 사람은 재무
 * 화면 자체에 못 들어오므로(`hasFinanceAccess`) 여기서 다시 가르지 않습니다.
 *
 * 인자는 부르는 자리를 바꾸지 않으려고 남겨 두었습니다.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function allowedScopes(_userDepartment?: string | null): string[] {
  return departmentTabs(ALL_SCOPE);
}

/**
 * 쿠키에 적힌 값을 믿을 수 있는 범위로 바꿉니다. 고를 수 없는 범위(남의 부서)는 버리고
 * 첫 번째 것으로 돌아갑니다 - 쿠키는 손으로 고칠 수 있습니다.
 */
export function resolveScope(raw: string | null | undefined, userDepartment: string | null | undefined): string {
  const allowed = allowedScopes(userDepartment);
  const v = (raw ?? "").trim();
  if (v && allowed.includes(v)) return v;
  return allowed[0] ?? ALL_SCOPE;
}

/** 이 범위의 화면이 보여줄 부서 탭. 부서 범위면 그 부서 하나뿐이라 탭 줄이 사라집니다. */
export function deptTabsForScope(scope: string, userDepartment: string | null | undefined): string[] {
  // 「전체 회계」는 재무 열쇠의 범위라 소속과 상관없이 모든 부서 탭을 보여줍니다(allowedScopes 와 같은 이유).
  if (scope === ALL_SCOPE) return allowedScopes(userDepartment);
  return [scope];
}

/** 이 학생이 지금 범위에 드는가. 부서 판정은 `departmentOf` 하나입니다(§2-2). */
export function inScope(scope: string, student: { department?: string | null; grade?: string | null } | null | undefined): boolean {
  if (scope === ALL_SCOPE) return true;
  if (!student) return false;
  return departmentOf({ department: student.department ?? null, grade: student.grade ?? null }) === scope;
}
