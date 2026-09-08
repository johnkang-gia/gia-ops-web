/**
 * 남에게 건네는 주소는 **언제나 정식 주소**입니다.
 *
 * 이 앱은 정식 주소 말고도 미리보기 주소로 열립니다(`...-git-staging-....vercel.app`).
 * 담당자가 미리보기에서 화면을 열고 QR·링크·스크립트를 만들면, 거기에 미리보기 주소가
 * 박힙니다. 그 주소는
 *
 *   · 배포마다 바뀌고,
 *   · Vercel 배포 보호에 걸려 **로그인 화면**을 돌려주며,
 *   · 그 로그인 화면은 HTTP 200 이라 보내는 쪽에는 «성공»으로 보입니다.
 *
 * 기사님 휴대폰, 교실 태블릿, 로비 안내보드, 구글시트 스크립트는 전부 이 주소를 그대로
 * 붙들고 씁니다. 한 번 잘못 박히면 몇 주 뒤에야 「왜 아무것도 안 들어오지」로 발견됩니다 -
 * 구글시트 명부가 정확히 그렇게 됐습니다(2026-09).
 *
 * 그래서 «지금 브라우저 주소»가 아니라 이 상수를 씁니다. 화면 안에서만 도는 이동
 * (로그인 콜백 등)은 지금 주소가 맞으므로 예외입니다.
 */
export const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_ORIGIN || "https://gia-ops.vercel.app").replace(/\/$/, "");

/** 지금 보고 있는 화면이 정식 주소가 아닌가. 그렇다면 만들어 준 링크를 믿으면 안 됩니다. */
export function onOtherOrigin(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.origin.replace(/\/$/, "") !== APP_ORIGIN;
}

/** 남에게 건넬 링크. 앞에 `/` 를 붙인 경로를 넘깁니다. */
export function shareUrl(path: string): string {
  return `${APP_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
