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

/** 이 사람이 고를 수 있는 범위. 「전체」 소속만 「전체 회계」가 있습니다. */
export function allowedScopes(userDepartment: string | null | undefined): string[] {
  return departmentTabs(userDepartment);
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
  if (scope === ALL_SCOPE) return departmentTabs(userDepartment);
  return [scope];
}

/** 이 학생이 지금 범위에 드는가. 부서 판정은 `departmentOf` 하나입니다(§2-2). */
export function inScope(scope: string, student: { department?: string | null; grade?: string | null } | null | undefined): boolean {
  if (scope === ALL_SCOPE) return true;
  if (!student) return false;
  return departmentOf({ department: student.department ?? null, grade: student.grade ?? null }) === scope;
}
