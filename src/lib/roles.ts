// 기존 .gs의 ADMIN_EMAILS/DEVELOPER_EMAILS를 그대로 옮겼습니다.
const DEVELOPER_EMAILS = ["johnkang@giamicro.com"];

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return DEVELOPER_EMAILS.includes(email.toLowerCase());
}

// layout.tsx에서 쓰던 권한 판정 로직을 페이지/API 라우트에서도 재사용할 수 있게 공용 함수로
// 뺐습니다(교사 전용 화면 접근 제한 등 여러 곳에서 같은 기준이 필요해짐).
// previewOf - 개발자가 "권한 미리보기"로 특정 직위인 척 화면을 확인하는 중이면 그 직위 문자열이
// 담깁니다(요청: "개발자 계정의 경우... 권한을 변경할 수 있게... 완전한 역할 전환 비슷하게라도
// 체크할 수 있으면"). 이 값이 있으면 개발자 전용 우회(isDeveloperEmail 통과)를 끄고 실제
// position 값만으로 판정해서, 그 직위가 실제로 보게 될 화면을 정확히 재현합니다.
type RoleUser = { email: string; position?: string | null; previewOf?: string | null } | null | undefined;

export function isAdminUser(user: RoleUser): boolean {
  if (!user) return false;
  if (user.previewOf) return user.position === "관리자";
  return isDeveloperEmail(user.email) || user.position === "관리자";
}

export function isTeacherOnly(user: RoleUser): boolean {
  if (!user) return false;
  if (user.previewOf) return user.position === "교사";
  return !isDeveloperEmail(user.email) && user.position === "교사";
}

export function isStaffOrAboveUser(user: RoleUser): boolean {
  if (!user) return false;
  return isAdminUser(user) || user.position === "행정직원";
}
