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
type RoleUser =
  | { email: string; position?: string | null; previewOf?: string | null; finance_access?: boolean | null }
  | null
  | undefined;

// ── 권한의 두 축 ────────────────────────────────────────────────────────
//
// 담당자: "재무관리자는 다른 사람들이 볼 때는 그냥 관리자로 보이도록."
//
// 처음에는 개발자 > 최고관리자 > 재무관리자 > 관리자 로 한 줄 세우려 했습니다. 그런데 재무는
// 위아래가 아니라 **다른 축**입니다. 재무를 보는 사람이 셔틀이나 학사를 관리자보다 더 잘 알
// 이유가 없고, 한 줄로 세우면 "재무만 보고 학생 명부는 못 보는 경리직원"을 만들 수 없습니다.
//
//   position       = 보이는 직위 (교사 · 행정직원 · 관리자 · 최고관리자 · 개발자)
//   finance_access = 재무 열쇠 (직위와 별개)
//
// 재무관리자 = 관리자 + 재무 열쇠. "남들에게 그냥 관리자로 보인다"가 **숨김 장치 없이**
// 성립합니다 - 실제로 관리자가 맞으니까요. 화면 한 군데를 빠뜨려도 드러날 것이 없습니다.

/** 최고관리자. 개발자 바로 밑이며, 계정 승인·권한 부여·재무 열쇠 발급을 맡습니다. */
export function isSuperAdminUser(user: RoleUser): boolean {
  if (!user) return false;
  if (user.previewOf) return user.position === "최고관리자";
  return isDeveloperEmail(user.email) || user.position === "최고관리자";
}

export function isAdminUser(user: RoleUser): boolean {
  if (!user) return false;
  if (user.previewOf) return user.position === "관리자" || user.position === "최고관리자";
  // 최고관리자를 빼먹으면 직위를 올려준 사람이 오히려 관리자 권한을 잃습니다.
  return isDeveloperEmail(user.email) || user.position === "관리자" || user.position === "최고관리자";
}

/**
 * 돈에 관한 화면을 볼 수 있는가.
 *
 * **직위로 판정하지 않습니다.** 관리자라고 자동으로 열리지 않고, 최고관리자도 열쇠를 따로
 * 받아야 합니다 - 겸직하실 수는 있지만 기본은 꺼두는 것이 기록상 깨끗합니다.
 * 개발자만 예외인데, 이건 권한이 아니라 화면을 고치기 위한 통로입니다.
 */
export function hasFinanceAccess(user: RoleUser): boolean {
  if (!user) return false;
  // 권한 미리보기 중에는 개발자 우회를 끕니다 - 그 직위가 실제로 보게 될 화면을 재현합니다.
  if (user.previewOf) return user.finance_access === true;
  return isDeveloperEmail(user.email) || user.finance_access === true;
}

/**
 * 재무 열쇠를 **부여·회수하거나 누가 갖고 있는지 볼 수 있는가.**
 *
 * 열쇠를 가진 것과 열쇠를 나눠주는 것은 다른 일입니다. 재무관리자 본인은 자기 열쇠를
 * 볼 수 없고, 개발자와 최고관리자만 봅니다(담당자 요청).
 */
export function canManageFinanceAccess(user: RoleUser): boolean {
  return isSuperAdminUser(user);
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
