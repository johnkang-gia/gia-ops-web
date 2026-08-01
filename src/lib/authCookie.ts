import { createHmac, timingSafeEqual } from "node:crypto";

// 미들웨어가 매 페이지 이동마다 app_users 테이블을 조회하면(네트워크 왕복 1회 추가) 클릭할
// 때마다 체감되는 지연이 생깁니다. 한 번 "이 사용자는 승인된 사용자다"라고 확인되면, 그 결과를
// 서명된 쿠키에 짧은 시간(TTL) 동안 캐싱해서 이후 요청들은 DB 조회 없이 쿠키 서명만 검사하고
// 통과시킵니다. PIN_COOKIE_SECRET을 재사용하므로 별도 환경변수 설정이 필요 없습니다.
//
// 보안 참고: 이 쿠키는 미들웨어의 "빠른 통과" 판단에만 쓰이고, 실제 데이터 접근 권한은 항상
// Supabase RLS(is_giamicro_user() 등)가 매 요청마다 독립적으로 검사합니다. 즉 이 캐시가 최대
// TTL만큼 낡은 값을 잠깐 신뢰하더라도, 실제 데이터 유출/변조로 이어지지 않습니다. 관리자가
// 사용자를 승인 취소/차단하면 최대 TTL 이내에 접근이 막힙니다.
const COOKIE_NAME = "gia_authok";
const TTL_SECONDS = 5 * 60; // 5분

function secret(): string {
  const s = process.env.PIN_COOKIE_SECRET;
  if (!s) throw new Error("PIN_COOKIE_SECRET이 설정되어 있지 않습니다.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function authOkCookieName(): string {
  return COOKIE_NAME;
}

export function authOkCookieMaxAge(): number {
  return TTL_SECONDS;
}

/**
 * 승인 확인을 통과했을 때 발급하는 캐시 쿠키 값(userId + 발급시각 + 직위 + 서명).
 * 직위(position)를 함께 넣어두는 이유는, 교사 계정을 위클리 리포트 화면으로만 제한하는
 * 미들웨어 판단도 이 캐시 쿠키만으로(=DB 재조회 없이) 빠르게 할 수 있도록 하기 위해서입니다.
 * position이 비어있으면 빈 문자열로 저장합니다.
 */
export function makeAuthOkCookieValue(userId: string, position: string | null = ""): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const safePosition = (position || "").replace(/:/g, "");
  const payload = `${userId}:${issuedAt}:${safePosition}`;
  return `${payload}:${sign(payload)}`;
}

/** 이 쿠키가 특정 userId에 대해 아직(TTL 이내) 유효한지 검사. */
export function isAuthOkCookieValid(userId: string, cookieValue: string | undefined): boolean {
  return readAuthOkCookie(userId, cookieValue) !== null;
}

/** 쿠키가 유효하면 안에 담긴 직위(position)를 반환하고, 유효하지 않으면 null을 반환. */
export function readAuthOkCookie(userId: string, cookieValue: string | undefined): { position: string } | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(":");
  if (parts.length !== 4) return null;
  const [cookieUserId, issuedAtStr, position, sig] = parts;
  if (cookieUserId !== userId) return null;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  if (Math.floor(Date.now() / 1000) - issuedAt > TTL_SECONDS) return null;

  const expected = sign(`${cookieUserId}:${issuedAtStr}:${position}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { position };
}
