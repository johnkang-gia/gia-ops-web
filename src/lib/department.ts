// 부서(유치부/초등부/중고등부) 판정을 한 곳에 모아둡니다.
//
// 요청: "부서는 유치부는 통합하지말고 따로 만들어 달라고 하셨어... 앞으로도 저런형식을가진
// 아이들을 유치부로 분류하고... 유치부는 우선 분리해서 표면적으로는 안보이게 해줘"
//
// 원칙: DB의 department 칸이 있으면 그 값을 그대로 믿고, 아직 안 채워진 예전 행에 대해서만
// 학년 표기로 추측합니다. 새 학기 데이터는 부서를 명시적으로 넣으므로 추측은 점점 안 쓰게 됩니다.

export const ALL_DEPARTMENTS = ["유치부", "초등부", "중고등부"] as const;
export type Department = (typeof ALL_DEPARTMENTS)[number];

// 지금 운영 화면(대시보드·시간표 등)에서 보여줄 부서입니다. 유치부는 별도 프로그램으로 따로
// 만들기로 해서 당분간 화면에서 감춥니다 - 데이터는 그대로 남아 있고, 나중에 유치부를 다시
// 노출하거나 전용 앱에서 쓸 때 이 배열에 넣기만 하면 됩니다.
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
  if (num >= 7) return "중고등부";
  if (num >= 1) return "초등부";
  return null;
}

// 실제로 쓰는 판정 함수 - department 칸이 우선이고, 없을 때만 학년으로 추측합니다.
export function departmentOf(row: { department?: string | null; grade?: string | null }): Department | null {
  if (row.department && (ALL_DEPARTMENTS as readonly string[]).includes(row.department)) {
    return row.department as Department;
  }
  return guessDepartmentFromGrade(row.grade);
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
