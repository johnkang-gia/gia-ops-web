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

/**
 * 지금 시각(한국) HH:MM:SS.
 *
 * 시간표의 `start_time`·`end_time` 은 시간대가 없는 시각(time)이고, 그건 **한국 시각**을
 * 뜻합니다. 브라우저가 다른 시간대에 있으면 `getHours()` 로 비교하는 순간 엉뚱한 교시가
 * 나옵니다 - 아무 오류 없이 「지금 체육」이라고만 보입니다.
 */
export function kstTime(at: Date | number = Date.now()): string {
  return new Date(at).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false });
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

/**
 * **받은 때를 «오늘 오전 10:05» 처럼.** 어제·그제 것이 섞이는 목록(확인 필요 등)에서 시각만 적으면
 * 어제 온 「오후 3:10 픽업」이 오늘 것처럼 읽히고, 사람은 오늘 아이를 기다립니다.
 *
 *   오늘 → 「오늘 오전 10:05」 · 어제 → 「어제 오후 3:20」 · 그 전 → 「10/12(일) 오전 9:00」
 *
 * 날짜는 한국 날짜로 견줍니다(브라우저·서버 시간대와 무관).
 */
export function receivedLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  // 오전·오후는 손으로 붙입니다 - 기기마다 한국어 표기가 없으면 「AM」으로 나옵니다.
  const [h, m] = kstTime(at).split(":").map(Number);
  const time = `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
  const day = kstDate(at);
  if (day === todayKst()) return `오늘 ${time}`;
  if (day === kstDateOffset(-1)) return `어제 ${time}`;
  const wd = "일월화수목금토"[new Date(`${day}T12:00:00+09:00`).getDay()];
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${wd}) ${time}`;
}
