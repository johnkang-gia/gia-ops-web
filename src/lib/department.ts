// 부서(유치부/초등부/중고등부) 판정을 한 곳에 모아둡니다.
//
// 요청: "부서는 유치부는 통합하지말고 따로 만들어 달라고 하셨어... 앞으로도 저런형식을가진
// 아이들을 유치부로 분류하고... 유치부는 우선 분리해서 표면적으로는 안보이게 해줘"
//
// 원칙: DB의 department 칸이 있으면 그 값을 그대로 믿고, 아직 안 채워진 예전 행에 대해서만
// 학년 표기로 추측합니다. 새 학기 데이터는 부서를 명시적으로 넣으므로 추측은 점점 안 쓰게 됩니다.

export const ALL_DEPARTMENTS = ["유치부", "초등부", "중고등부"] as const;
export type Department = (typeof ALL_DEPARTMENTS)[number];

// 지금 운영 화면(대시보드·시간표 등)에서 보여줄 부서입니다.
//
// 초등부와 중고등부를 함께 보여줍니다. 중고등부도 이 앱으로 운영하기로 정해졌습니다
// (인보이스·학생 명부를 한 곳에서 봅니다). 유치부는 별도 프로그램으로 따로 만들기로 해서
// 감춰져 있습니다.
//
// 데이터는 어느 쪽도 지우지 않았습니다 - 중고등부·유치부 학생은 그대로 남아 있고, 나중에 그
// 부서를 이 앱에서 쓰기로 하면 이 배열에 이름만 넣으면 바로 화면에 나타납니다.
export const VISIBLE_DEPARTMENTS = ["초등부", "중고등부"] as const;
export type VisibleDepartment = (typeof VISIBLE_DEPARTMENTS)[number];

export function isVisibleDepartment(value: string | null | undefined): value is VisibleDepartment {
  return !!value && (VISIBLE_DEPARTMENTS as readonly string[]).includes(value);
}

// 학년 표기만 있는 예전 데이터를 위한 추측 규칙(DB에 department가 채워지면 쓰이지 않습니다).
export function guessDepartmentFromGrade(grade: string | null | undefined): Department | null {
  if (!grade) return null;
  const g = grade.trim();
  if (/유치|^K|^유/i.test(g)) return "유치부";
  if (/중|고/.test(g)) return "중고등부";
  const num = parseInt(g.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(num)) return null;
  // **6학년부터 중고등부입니다.** 이 학교는 6학년을 중고등부에서 운영합니다 - 학년 숫자만
  // 보고 7부터 나누면 6학년이 초등부로 잘못 묶입니다.
  if (num >= 6) return "중고등부";
  if (num >= 1) return "초등부";
  return null;
}

/**
 * 실제로 쓰는 판정 함수. **모든 화면이 이 하나만 씁니다.**
 *
 * 학년으로 판정할 수 있으면 **학년이 먼저**입니다. 부서 칸은 예전 명부에서 들어온 값이라,
 * 학교가 기준을 바꾸면(6학년을 중고등부로) 그 값들이 어긋난 채로 남습니다. 그러면 화면마다
 * 다른 답이 나오고, 어디가 맞는지 아무도 모르게 됩니다.
 *
 * 부서 칸은 **학년으로 판정이 안 될 때만** 씁니다 - 학년 표기가 비었거나 읽을 수 없는 줄.
 */
export function departmentOf(row: { department?: string | null; grade?: string | null }): Department | null {
  const byGrade = guessDepartmentFromGrade(row.grade);
  if (byGrade) return byGrade;
  if (row.department && (ALL_DEPARTMENTS as readonly string[]).includes(row.department)) {
    return row.department as Department;
  }
  return null;
}

// 학년 표기를 정렬 가능한 숫자로 바꿉니다(대시보드에서 학년별로 묶어 보여줄 때 씀).
// '1', '초1', '1학년' → 1 / '중1', '7' → 7 처럼 취급하고, 못 읽으면 맨 뒤로 보냅니다.
export function gradeSortKey(grade: string | null | undefined): number {
  if (!grade) return 999;
  const g = grade.trim();
  const num = parseInt(g.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(num)) return 998;
  if (/중/.test(g)) return 6 + num; // 중1 → 7
  if (/고/.test(g)) return 9 + num; // 고1 → 10
  return num;
}
