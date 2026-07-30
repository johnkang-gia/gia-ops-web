// 기존 .gs의 ADMIN_EMAILS/DEVELOPER_EMAILS를 그대로 옮겼습니다.
export const DEVELOPER_EMAILS = ["johnkang@giamicro.com"];

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return DEVELOPER_EMAILS.includes(email.toLowerCase());
}
