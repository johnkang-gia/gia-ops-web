// 개발자용 "권한 미리보기(역할 전환)" 기능 - 요청("테스트를 하기 때문에 개발자의 경우 각
// 권한별로 어디까지 보이고 어떤것을 할 수 있는지 체크하고 싶은데... 완전한 역할 전환 비슷하게라도
// 체크할 수 있으면 좋을거 같아"). 실제 Supabase 계정을 바꾸지 않고, 개발자 브라우저에만 심는
// 쿠키 하나로 "지금부터 이 직위인 것처럼 화면을 보여줘"를 표시합니다. 값이 없으면(=쿠키 없음)
// 평소처럼 개발자 전용 화면이 그대로 보입니다.
//
// 보안 경계: 이 쿠키는 화면(페이지/네비게이션) 표시 범위만 바꿉니다. 실제 데이터 변경이 걸린
// API 라우트는 이 쿠키를 보지 않고 진짜 로그인 계정 기준으로만 권한을 판정해야 합니다 - 그래야
// "관리자 화면이 안 보이는지" 테스트하다가 실수로 진짜 관리자 권한까지 잃어버리는 일이 없습니다.
export const ROLE_PREVIEW_COOKIE = "dev_preview_position";

// 최고관리자도 미리보기에 넣습니다 - 계층을 새로 만들었으니 "그 사람 눈에 뭐가 보이나"를
// 확인할 수 있어야 합니다. 재무 열쇠는 미리보기 중에는 항상 꺼집니다(currentUser.ts).
export const PREVIEW_POSITIONS = ["교사", "행정직원", "관리자", "최고관리자"] as const;
export type PreviewPosition = (typeof PREVIEW_POSITIONS)[number];

export function isValidPreviewPosition(value: string | null | undefined): value is PreviewPosition {
  return !!value && (PREVIEW_POSITIONS as readonly string[]).includes(value);
}
