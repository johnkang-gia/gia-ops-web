/**
 * 재무 화면들이 함께 쓰는 조건의 이름과 «한 칸 검색»의 규칙.
 *
 * 검색칸 하나로 한글 이름·영문 이름·초성(ㄱㅇㅅㄷ)·반·청구서 번호를 모두 받습니다. 화면마다
 * 받는 것이 달랐습니다 - 학비 표는 반 이름을 받고 학생별 회계는 안 받아서, 같은 글자를 쳐도
 * 화면마다 다른 아이가 나왔습니다.
 */

export const FINANCE_MONTH_COOKIE = "gia_fin_month";
export const FINANCE_TERM_COOKIE = "gia_fin_term";

const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 한글 글자를 초성으로 바꿉니다. 「김에스더」 → 「ㄱㅇㅅㄷ」. 한글이 아닌 글자는 그대로. */
export function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}

const isAllCho = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");

export type SearchableStudent = {
  name: string;
  nameEn?: string | null;
  className?: string | null;
  grade?: string | null;
  /** 이 학생의 청구서 번호들(2026-0354). 번호로 찾는 경우가 많습니다 - 학부모가 번호를 읽어 줍니다. */
  invoiceNos?: readonly string[];
};

/**
 * 검색어가 이 학생에 맞는가. 빈 검색어는 언제나 맞습니다.
 *
 * 띄어쓰기로 나눈 낱말이 **모두** 어딘가에 맞아야 합니다 - 「g2c 김」은 G2C 반의 김씨입니다.
 */
export function matchesStudentQuery(q: string, s: SearchableStudent): boolean {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = norm([s.name, s.nameEn ?? "", s.className ?? "", ...(s.invoiceNos ?? [])].join(" "));
  const cho = chosung(s.name);
  return words.every((w) => {
    if (isAllCho(w)) return cho.includes(w);
    const n = norm(w);
    if (/^\d+학년$/.test(w)) return (s.grade ?? "").trim() === w.replace("학년", "");
    return hay.includes(n);
  });
}
