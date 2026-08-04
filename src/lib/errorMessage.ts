// Postgres/Supabase 에러(error.message)를 그대로 alert에 띄우면 비개발자 사용자에게
// "new row violates row-level security policy" 같은 영어 원문이 그대로 노출됩니다.
// 화면에는 항상 이해하기 쉬운 한국어 문구만 보여주고, 실제 원인은 콘솔에만 남깁니다
// (개발자가 나중에 브라우저 콘솔 로그로 원인을 추적할 수 있도록).
export function friendlyError(
  prefix: string,
  err: unknown,
  fallback = "일시적인 오류입니다. 잠시 후 다시 시도해주세요."
): string {
  console.error(prefix, err);
  return `${prefix} ${fallback}`;
}
