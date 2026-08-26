// 한국어/영어 전환의 공통 기반입니다(요청: "교사권한이 볼 수 있는 페이지는 영/한 완전히
// 변환할 수 있게").
//
// 지금까지 교사 화면은 "한글 옆에 영어를 작게 병기"하는 방식이었는데, 병기는 화면이 길어지고
// 원어민 교사 입장에서는 여전히 한글이 먼저 눈에 들어와 읽기 불편합니다. 그래서 화면 전체를
// 한 언어로 "완전히" 바꾸는 방식으로 바꿉니다.
//
// 선택한 언어는 쿠키에 저장합니다. localStorage가 아니라 쿠키인 이유는, 이 앱의 화면 대부분이
// 서버 컴포넌트라서 서버가 렌더링하는 시점에 이미 언어를 알아야 하기 때문입니다(localStorage는
// 브라우저에만 있어서 서버가 읽을 수 없고, 그러면 한글로 한 번 그려진 뒤 영어로 바뀌며 깜빡입니다).
//
// 이 파일에는 "use client"도 서버 전용 코드도 넣지 않습니다 - 서버 컴포넌트와 클라이언트
// 컴포넌트 양쪽에서 그대로 import하기 위해서입니다.

export type Lang = "ko" | "en";

export const LANG_COOKIE = "gia_lang";

// 1년. 한 번 영어로 바꾼 원어민 교사가 매번 다시 바꾸지 않도록 넉넉히 둡니다.
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_LANG: Lang = "ko";

export function isLang(value: unknown): value is Lang {
  return value === "ko" || value === "en";
}

export function normalizeLang(value: unknown): Lang {
  return isLang(value) ? value : DEFAULT_LANG;
}

// 화면 코드에서 쓰는 번역 함수를 만듭니다.
//
//   const t = makeT(lang);
//   <h1>{t("내 반 픽업 체크", "My Class Pickup Check")}</h1>
//
// 번역 키 파일을 따로 두지 않고 한글·영어를 나란히 적는 방식을 골랐습니다. 화면 코드를 읽을 때
// 무슨 문장이 나오는지 바로 보이고, 키 이름을 짓거나 사전 파일과 화면을 오가며 맞출 필요가
// 없어서 번역 누락이 생기기 어렵습니다.
//
// 영어를 아직 채우지 않았으면(en이 비어 있으면) 한글을 그대로 보여줍니다 - 번역이 빠진 자리가
// 빈칸으로 남아 화면이 깨지는 것보다 낫습니다.
export type T = (ko: string, en?: string) => string;

// 교시 이름은 DB(wr_periods.label)에 한국어로 저장되어 있습니다("1교시", "점심"). 영어로 쓰는
// 원어민 선생님 화면에서도 이 값만 한글로 남아 있었는데(요청: "1교시 한글표기되어있고"),
// 저장된 값을 언어별로 두 벌 만들면 학기마다 교시를 고칠 때 한쪽만 고쳐져 어긋납니다.
// 그래서 저장은 한 벌로 두고, 화면에 낼 때만 규칙으로 바꿔 씁니다.
//   "3교시" → "Period 3" · "점심"/"중식" → "Lunch" · "방과후" → "After School"
// 규칙에 없는 자유 입력 라벨은 그대로 둡니다(임의로 번역하면 오히려 못 알아봅니다).
const PERIOD_LABEL_EN: Record<string, string> = {
  점심: "Lunch",
  중식: "Lunch",
  석식: "Dinner",
  아침: "Morning",
  조회: "Homeroom",
  종례: "Closing",
  방과후: "After School",
  자습: "Study",
  휴식: "Break",
};

export function periodLabel(label: string | null | undefined, lang: Lang): string {
  const raw = (label ?? "").trim();
  if (!raw) return "";
  if (lang !== "en") return raw;
  const m = raw.match(/^(\d{1,2})\s*교시$/);
  if (m) return `Period ${m[1]}`;
  return PERIOD_LABEL_EN[raw] ?? raw;
}

export function makeT(lang: Lang): T {
  return (ko: string, en?: string) => (lang === "en" && en ? en : ko);
}

// <html lang="..."> 에 넣을 값. 브라우저 번역기·스크린리더가 이 값을 봅니다.
export function htmlLang(lang: Lang): string {
  return lang === "en" ? "en" : "ko";
}
