import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "gia_pin_ok";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12시간마다 다시 확인

function secret(): string {
  const s = process.env.PIN_COOKIE_SECRET;
  if (!s) throw new Error("PIN_COOKIE_SECRET이 설정되어 있지 않습니다.");
  return s;
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10); // yyyy-MM-dd (UTC 기준, 발급/검증 모두 동일 기준 사용)
}

export function pinCookieName(): string {
  return COOKIE_NAME;
}

export function pinCookieMaxAge(): number {
  return COOKIE_MAX_AGE_SECONDS;
}

/** PIN 확인 성공 시 브라우저에 심을 쿠키 값(오늘 날짜 + 사용자 id에 대한 HMAC). */
export function makePinCookieValue(userId: string): string {
  const h = createHmac("sha256", secret());
  h.update(`${userId}:${dayStamp()}`);
  return h.digest("hex");
}

/** proxy.ts에서 쿠키가 유효한지(오늘 날짜 기준으로 이 사용자가 PIN을 확인했는지) 검사. */
export function isPinCookieValid(userId: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const expected = makePinCookieValue(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(cookieValue);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** PIN 원문은 저장하지 않고, 무작위 salt + salt를 섞은 SHA-256 해시만 저장합니다. */
export function genSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPin(pin: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}
