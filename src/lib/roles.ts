// 기존 .gs의 ADMIN_EMAILS/DEVELOPER_EMAILS를 그대로 옮겼습니다.
export const DEVELOPER_EMAILS = ["johnkang@giamicro.com"];

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return DEVELOPER_EMAILS.includes(email.toLowerCase());
}

// layout.tsx에서 쓰던 권한 판정 로직을 페이지/API 라우트에서도 재사용할 수 있게 공용 함수로
// 뺐습니다(교사 전용 화면 접근 제한 등 여러 곳에서 같은 기준이 필요해짐).
type RoleUser = { email: string; position?: string | null } | null | undefined;

export function isAdminUser(user: RoleUser): boolean {
  if (!user) return false;
  return isDeveloperEmail(user.email) || user.position === "관리자";
}

export function isTeacherOnly(user: RoleUser): boolean {
  if (!user) return false;
  return !isDeveloperEmail(user.email) && user.position === "교사";
}

export function isStaffOrAboveUser(user: RoleUser): boolean {
  if (!user) return false;
  return isAdminUser(user) || user.position === "행정직원";
}
