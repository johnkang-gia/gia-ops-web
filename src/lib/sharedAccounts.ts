// 공용 가계정(요청: "도서관이랑, 오리엔테이션용 가계정을 만들어서 관리하게 해줘").
//
// 개인 구글 계정과 달리 여러 사람이 돌아가며 쓰는 계정입니다. 두 종류가 있습니다.
//
//  - 도서관 계정(gia-library…): 도서관 대출 노트북 전용. 하루 종일 로그인된 채 열려 있어서
//    운영앱(사건기록·학생 개인정보)까지 보이면 안 되므로, 미들웨어와 DB 양쪽에서 운영앱 접근을
//    막습니다.
//  - 교육용 계정(gia-demo…): 신입교사 오리엔테이션 전용. 교사 화면을 실제와 똑같이 보여주되,
//    보이는 학생은 전부 가짜 데이터입니다(요청: "매번 신입선생님들이 오면 설명을 해야 하니 아예
//    가계정 하나와 더미데이터로 어떻게 써넣으면 될지 알려줄 수 있게").
//
// 계정 이름으로 종류를 구분하는 이유는, 판별에 DB 조회가 필요하면 미들웨어가 매 요청마다 한 번씩
// 더 왕복해야 하기 때문입니다. 이름 규칙만으로 판단하면 조회 없이 즉시 걸러집니다. 같은 규칙이
// Postgres 함수(is_giamicro_user, is_demo_user)에도 그대로 들어가 있어 화면과 DB의 판단이
// 어긋나지 않습니다.

export const SHARED_ACCOUNT_DOMAIN = "@giamicro.com";

// 공용 계정은 모두 이 접두어로 시작합니다. 개인 계정(이름 기반)과 한눈에 구분되고, 나중에
// 계정이 늘어나도 목록을 따로 관리할 필요가 없습니다.
export const SHARED_ACCOUNT_PREFIX = "gia-";

export const LIBRARY_ACCOUNT_PREFIX = "gia-library";
export const DEMO_ACCOUNT_PREFIX = "gia-demo";

// 오리엔테이션 기본 계정입니다. 관리자 화면에서 이 계정을 만들고 비밀번호를 정합니다.
export const DEMO_ACCOUNT_EMAIL = "gia-demo@giamicro.com";

function normalize(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

// 아이디만 입력해도 로그인되도록 도메인을 붙여줍니다. 전체 주소를 입력했으면 그대로 둡니다.
export function toSharedAccountEmail(input: string): string {
  const value = input.trim().toLowerCase();
  if (!value) return "";
  return value.includes("@") ? value : `${value}${SHARED_ACCOUNT_DOMAIN}`;
}

// 이메일에서 아이디 부분만 떼어냅니다(화면에 "gia-demo"처럼 짧게 보여줄 때).
export function sharedAccountId(email: string | null | undefined): string {
  return normalize(email).split("@")[0] ?? "";
}

export function isSharedAccount(email: string | null | undefined): boolean {
  const value = normalize(email);
  return value.startsWith(SHARED_ACCOUNT_PREFIX) && value.endsWith(SHARED_ACCOUNT_DOMAIN);
}

export function isLibraryAccount(email: string | null | undefined): boolean {
  const value = normalize(email);
  return value.startsWith(LIBRARY_ACCOUNT_PREFIX) && value.endsWith(SHARED_ACCOUNT_DOMAIN);
}

export function isDemoAccount(email: string | null | undefined): boolean {
  const value = normalize(email);
  return value.startsWith(DEMO_ACCOUNT_PREFIX) && value.endsWith(SHARED_ACCOUNT_DOMAIN);
}

export type SharedAccountKind = "library" | "demo";

export const SHARED_ACCOUNT_KINDS: {
  kind: SharedAccountKind;
  defaultId: string;
  labelKo: string;
  labelEn: string;
  descriptionKo: string;
}[] = [
  {
    kind: "demo",
    defaultId: "gia-demo",
    labelKo: "오리엔테이션(교육용)",
    labelEn: "Orientation (training)",
    descriptionKo:
      "신입교사 교육용입니다. 교사 화면이 실제와 똑같이 보이지만 학생은 전부 가짜 데이터라, 마음껏 눌러보고 잘못 저장해도 실제 기록에는 영향이 없습니다.",
  },
  {
    kind: "library",
    defaultId: "gia-library",
    labelKo: "도서관 노트북",
    labelEn: "Library laptop",
    descriptionKo:
      "도서관 대출·반납 노트북 전용입니다. 이 계정으로는 운영앱(사건기록·학생 개인정보)에 들어올 수 없고 도서관 시스템만 열립니다.",
  },
];

export function accountKindOf(email: string | null | undefined): SharedAccountKind | null {
  if (isLibraryAccount(email)) return "library";
  if (isDemoAccount(email)) return "demo";
  return null;
}
