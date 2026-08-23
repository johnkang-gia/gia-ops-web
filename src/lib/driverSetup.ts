// 기사님 휴대폰 설정에 필요한 값들을 한 곳에 모아둡니다. 관리자 화면(QR·문자 발송),
// 기사님 설정 페이지(/s/[코드]), 안내문 DOCX가 모두 이 값을 씁니다 - 세 군데에 따로 적어두면
// 언젠가 한 곳만 바뀌어서 기사님이 잘못된 값을 넣게 됩니다.

// Traccar Client - 무료 오픈소스, 광고·결제 없음. 안드로이드·아이폰 모두 있습니다.
export const TRACCAR_ANDROID_URL = "https://play.google.com/store/apps/details?id=org.traccar.client";
export const TRACCAR_IOS_URL = "https://apps.apple.com/app/traccar-client/id843156974";

export type Platform = "android" | "ios" | "unknown";

// 기사님 설정 페이지는 기사님 휴대폰에서 열리므로, 어느 쪽 안내를 먼저 보여줄지 정합니다.
// 판별에 실패하면 둘 다 보여줍니다(틀린 안내를 자신 있게 보여주는 것보다 낫습니다).
export function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  return "unknown";
}

export function storeUrl(platform: Platform): string {
  return platform === "ios" ? TRACCAR_IOS_URL : TRACCAR_ANDROID_URL;
}

// 앱 설정 화면에 넣을 값입니다. label은 앱에 영어로 표시되는 실제 항목 이름이라 그대로 두고,
// 한국어 설명을 함께 보여줍니다(기사님이 화면에서 항목을 찾으실 수 있도록).
export type TraccarSetting = {
  label: string;
  ko: string;
  value: string;
  why: string;
  critical?: boolean;
};

export const TRACCAR_SETTINGS: TraccarSetting[] = [
  {
    label: "Location accuracy",
    ko: "위치 정확도",
    value: "Highest",
    why: "정류장 도착을 정확히 잡으려면 가장 높은 정확도가 필요합니다.",
  },
  {
    label: "Frequency / Interval",
    ko: "전송 간격",
    value: "30",
    why: "30초마다 한 번. 더 짧으면 배터리를, 더 길면 정확도를 잃습니다.",
  },
  {
    label: "Distance",
    ko: "거리",
    value: "0",
    why: "거리 조건 없이 시간 간격대로만 보냅니다.",
  },
  {
    label: "Angle",
    ko: "각도",
    value: "0",
    why: "방향 조건 없이 시간 간격대로만 보냅니다.",
  },
  {
    label: "Stop detection",
    ko: "정차 감지",
    value: "끄기 (OFF)",
    why: "★ 가장 중요합니다. 켜져 있으면 차가 서 있는 동안 위치를 보내지 않아 정류장 도착을 놓칩니다.",
    critical: true,
  },
  {
    label: "Offline buffering",
    ko: "오프라인 저장",
    value: "켜기 (ON)",
    why: "지하차도·터널에서 신호가 끊겨도 나중에 몰아서 보냅니다.",
  },
  {
    label: "Wake lock",
    ko: "절전 방지 (안드로이드만)",
    value: "켜기 (ON)",
    why: "화면이 꺼져도 전송이 멈추지 않습니다.",
  },
];

// 설정 링크의 주소를 만듭니다. /s/ 로 아주 짧게 둔 이유는 문자로 보냈을 때 한 줄에 들어가고,
// 필요하면 주소창에 직접 칠 수도 있어야 하기 때문입니다.
export function driverSetupPath(setupCode: string): string {
  return `/s/${setupCode}`;
}

// 문자 앱을 여는 링크입니다. 별도 문자 발송 API(유료 가입 필요)를 쓰지 않고, 담당자 휴대폰의
// 기본 문자 앱을 열어 내용을 채워주는 방식입니다. 카카오톡으로 보내시려면 [링크 복사]를 눌러
// 붙여넣으시면 됩니다.
export function smsHref(phone: string, body: string): string {
  const digits = phone.replace(/[^0-9+]/g, "");
  // iOS는 본문 구분자로 &가 아니라 ;를 쓰는 기기가 있어 둘 다 통하는 &body= 형태를 씁니다.
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}

export function setupMessage(routeLabel: string, url: string): string {
  return [
    `[GIA 국제학교] ${routeLabel} 기사님, 하원차량 위치안내 설정 링크입니다.`,
    url,
    "링크를 누르시면 설치와 설정 방법이 순서대로 나옵니다. 5분이면 끝납니다.",
  ].join("\n");
}
