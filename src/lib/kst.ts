// "오늘"은 한국 날짜입니다. 한 곳에서만 정합니다.
//
// 이 파일이 생긴 이유:
//
// 코드 곳곳에 `new Date().toISOString().slice(0, 10)`이 스무 곳 넘게 흩어져 있었습니다.
// 이건 **UTC 날짜**입니다. 한국 시간 00:00~09:00 사이에는 하루 전 날짜가 나옵니다.
//
// 그래서 아침 8시에 하원 체크표나 픽업 체크를 열면 **어제 명단이 뜹니다.** 오후에만 쓰던
// 화면이라 눈에 안 띄었을 뿐, 담임 선생님들이 아침에 열기 시작하면 바로 드러납니다.
//
// 실제로 이 종류의 버그를 이미 세 번 고쳤습니다(출결 등록 / GPS 출발 판정 / 도착체크).
// 매번 "그 파일만" 고쳤고, 그래서 매번 다시 나왔습니다. 이제 함수 하나로 모읍니다.
//
// 서버·브라우저 어디서 불러도 같은 답을 냅니다. 'sv-SE' 로캘이 YYYY-MM-DD 형태를 주기
// 때문에 날짜 키로 그대로 쓸 수 있습니다.

/** 오늘(한국 기준) YYYY-MM-DD. */
export function todayKst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** 어떤 시각이든 그날의 한국 날짜 YYYY-MM-DD. DB의 UTC 타임스탬프를 묶을 때 씁니다. */
export function kstDate(value: Date | string | number): string {
  return new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** 오늘 기준 며칠 전/후(한국). 음수면 과거입니다. */
export function kstDateOffset(days: number): string {
  return kstDate(Date.now() + days * 86400000);
}

/** 한국 요일. 0=일 … 6=토. */
export function kstWeekday(): number {
  // 정오로 만들어 시간대 경계에서 하루가 밀리지 않게 합니다.
  return new Date(`${todayKst()}T12:00:00+09:00`).getDay();
}

// "3분 전" 같은 상대 시각. 네 파일에 똑같은 코드가 복사돼 있던 것을 하나로 모았습니다.
//
// 글자 하나만 달라져도 화면마다 다른 말이 나옵니다. 같은 뜻이면 같은 곳에서 나와야 합니다.
export function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
}
