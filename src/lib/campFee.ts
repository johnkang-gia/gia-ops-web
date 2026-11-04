/**
 * 캠프 수강료 — 금액 계산과 구글폼 응답 읽기 (순수 함수).
 *
 * ── 금액 ─────────────────────────────────────────────────────────────────
 *
 * 주당 900,000원. 셔틀을 안 타면 주당 50,000원, 편도면 주당 25,000원을 뺍니다. 그다음 할인율 **하나**를
 * 전체에 곱합니다. 2026 윈터캠프 요금표(3주·2주 × 셔틀 셋 × 할인 넷 = 24칸)가 전부 이 식으로 맞습니다
 * (scripts/test-camp-fee.ts 가 24칸을 다시 셉니다).
 *
 * 2주 참여는 1주차를 빼고 2~3주차입니다. 금액은 주 수만 봅니다.
 *
 * ── 할인은 하나만 ─────────────────────────────────────────────────────────
 *
 * 겹치면 고르지 않고 정해진 순서로 하나만 씁니다.
 *   · 재학생이면 언제나 재학생 30% (형제·재수강이어도)
 *   · 외부 학생이 형제면 형제 10%
 *   · 외부 학생이 재수강이면 재수강 5%
 * 외부 학생이 형제이면서 재수강이면 형제 10% 입니다 - 형제면 형제 할인만 적용한다는 것이 학교의 기준이고,
 * 두 할인 중 큰 쪽이기도 합니다. 사람이 화면에서 다른 할인을 고르면(discountOverride) 그것이 이깁니다.
 *
 * 청구서는 캠프마다 한 장, 수강료 한 줄입니다. 나중에 더 받을 것이 생기면 따로 한 장을 더 만듭니다.
 */

export const CAMP_WEEKLY = 900_000;
export const SHUTTLE_OFF_PER_WEEK: Record<CampShuttle, number> = { 왕복: 0, 편도: 25_000, 미이용: 50_000 };
export const DISCOUNT_RATE: Record<CampDiscount, number> = { 재학생: 0.3, 형제: 0.1, 재수강: 0.05, 없음: 0 };

export type CampShuttle = "왕복" | "편도" | "미이용";
export type CampDiscount = "재학생" | "형제" | "재수강" | "없음";
export const CAMP_DISCOUNTS: CampDiscount[] = ["재학생", "형제", "재수강", "없음"];
export const CAMP_SHUTTLES: CampShuttle[] = ["왕복", "편도", "미이용"];

/** 규칙대로의 할인. 재학생 → 형제 → 재수강 순서로 하나만. */
export function campDiscountOf(a: {
  isCurrent: boolean;
  sibling: boolean;
  returning: boolean;
  override?: CampDiscount | null;
}): CampDiscount {
  if (a.override) return a.override;
  if (a.isCurrent) return "재학생";
  if (a.sibling) return "형제";
  if (a.returning) return "재수강";
  return "없음";
}

export type CampFee = { gross: number; rate: number; discountAmount: number; amount: number };

/** 주 수·셔틀이 정해지지 않았으면 null - 모르는 채로 금액을 만들지 않습니다. */
export function campFee(weeks: number | null | undefined, shuttle: CampShuttle | null | undefined, discount: CampDiscount): CampFee | null {
  if (weeks !== 2 && weeks !== 3) return null;
  if (!shuttle) return null;
  const gross = (CAMP_WEEKLY - SHUTTLE_OFF_PER_WEEK[shuttle]) * weeks;
  const rate = DISCOUNT_RATE[discount];
  const amount = Math.round(gross * (1 - rate));
  return { gross, rate, discountAmount: gross - amount, amount };
}

/** 청구서 줄 이름. 무엇에 대한 돈인지 학부모가 읽고 알 수 있게 주·셔틀·할인을 함께 적습니다. */
export function campLineName(termLabel: string, weeks: number, shuttle: CampShuttle, discount: CampDiscount): string {
  const w = weeks === 3 ? "3주(1~3주차)" : "2주(2~3주차)";
  const sh = shuttle === "왕복" ? "셔틀 이용" : shuttle === "편도" ? "셔틀 편도" : "셔틀 미이용";
  const dc = discount === "없음" ? "" : ` · ${discount} ${Math.round(DISCOUNT_RATE[discount] * 100)}%`;
  return `${termLabel} 수강료 · ${w} · ${sh}${dc}`;
}

// ── 구글폼 응답 읽기 ───────────────────────────────────────────────────────

export type CampForm = {
  applicant_name: string;
  applicant_name_en: string | null;
  grade: string | null;
  birth_date: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  email: string | null;
  weeks: 2 | 3 | null;
  shuttle: CampShuttle | null;
  says_current: boolean;
  sibling: boolean;
  returning: boolean;
  submitted_at: string | null;
  /** 어느 머리줄을 어느 칸으로 읽었는지. 화면이 보여줘서 «잘못 읽음»을 사람이 알아챕니다. */
  used: Record<string, string>;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const low = (s: string) => norm(s).toLowerCase();

function yes(v: string): boolean {
  const t = low(v);
  if (!t) return false;
  if (/아니|없|no\b|^n$|해당\s*없|x$/.test(t)) return false;
  return /^(예|네|yes|y|o|있|해당|true|맞|재학|재원|형제|자매|재수강)/.test(t) || /있음|있습니다|예\b/.test(t);
}

export function parseWeeks(v: string): 2 | 3 | null {
  const t = low(v).replace(/～|〜/g, "~");
  if (!t) return null;
  if (/2\s*[~\-]\s*3/.test(t)) return 2;
  if (/1\s*[~\-]\s*3/.test(t) || /전체|전\s*기간|full/.test(t)) return 3;
  if (/3\s*(주|week|wk)/.test(t)) return 3;
  if (/2\s*(주|week|wk)/.test(t)) return 2;
  return null;
}

export function parseShuttle(v: string): CampShuttle | null {
  const t = low(v);
  if (!t) return null;
  if (/편도|one[\s-]?way|등원만|하원만/.test(t)) return "편도";
  if (/미이용|이용\s*안|이용하지|안\s*함|불필요|필요\s*없|no\b|not|자차|직접/.test(t)) return "미이용";
  if (/왕복|이용|yes|round|탑승|필요/.test(t)) return "왕복";
  return null;
}

/** 시트 칸 값을 날짜 글자로. 앱스크립트가 ISO 로 보내지만, 사람이 적은 「2017.3.5」 같은 것도 받습니다. */
function dateText(v: string): string | null {
  const t = norm(v);
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = t.match(/(\d{4})\s*[.\/년-]\s*(\d{1,2})\s*[.\/월-]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return t;
}

type Field = keyof Omit<CampForm, "used" | "says_current" | "sibling" | "returning">;

/**
 * 머리줄 → 칸. 폼 질문 문구는 해마다 바뀌므로 정확한 글자가 아니라 **낱말**로 찾습니다. 먼저 맞은 규칙이
 * 그 머리줄을 가져갑니다(학생 영문 이름이 학생 이름으로, 보호자 이름이 학생 이름으로 읽히지 않게 순서가 중요).
 */
const RULES: { field: Field; test: (h: string) => boolean }[] = [
  { field: "submitted_at", test: (h) => /타임스탬프|timestamp|제출\s*시각/.test(h) },
  { field: "email", test: (h) => /이메일|e-?mail|메일/.test(h) },
  { field: "guardian_phone", test: (h) => /연락처|전화|휴대|핸드폰|phone|mobile|contact/.test(h) },
  { field: "guardian_name", test: (h) => /(보호자|학부모|부모|parent|guardian)/.test(h) && /(이름|성함|성명|name)/.test(h) },
  { field: "applicant_name_en", test: (h) => /(영문|english|영어)/.test(h) && /(이름|성명|name)/.test(h) },
  { field: "birth_date", test: (h) => /생년|생일|birth|dob/.test(h) },
  { field: "grade", test: (h) => /학년|grade/.test(h) },
  { field: "weeks", test: (h) => /(주|week)/.test(h) && /(참여|기간|신청|과정|선택|week)/.test(h) && !/셔틀|차량/.test(h) },
  { field: "shuttle", test: (h) => /셔틀|차량|shuttle|bus/.test(h) },
  { field: "applicant_name", test: (h) => /(이름|성명|name)/.test(h) },
];

export function readCampForm(answers: Record<string, string>): CampForm {
  const out: CampForm = {
    applicant_name: "",
    applicant_name_en: null,
    grade: null,
    birth_date: null,
    guardian_name: null,
    guardian_phone: null,
    email: null,
    weeks: null,
    shuttle: null,
    says_current: false,
    sibling: false,
    returning: false,
    submitted_at: null,
    used: {},
  };
  for (const [rawHeader, rawValue] of Object.entries(answers)) {
    const h = low(rawHeader);
    const v = norm(String(rawValue ?? ""));
    if (!h) continue;

    // 할인에 쓰이는 대답. 「해당하는 것을 고르세요: 재학생 / 형제 / 재수강」 처럼 한 질문에 몰아 묻는 폼도 있습니다.
    const lv = low(v);
    if (/재학|재원|현재\s*(gia|학생)|gia\s*학생|소속/.test(h)) {
      if (yes(v) || /재학|재원/.test(lv)) out.says_current = true;
      out.used[rawHeader] = "재학생 여부";
      continue;
    }
    if (/형제|자매|sibling/.test(h)) {
      if (yes(v)) out.sibling = true;
      out.used[rawHeader] = "형제 여부";
      continue;
    }
    if (/재수강|이전\s*캠프|참여\s*(경험|이력)|returning|다시/.test(h)) {
      if (yes(v)) out.returning = true;
      out.used[rawHeader] = "재수강 여부";
      continue;
    }
    if (/할인|구분|해당/.test(h)) {
      if (/재학|재원/.test(lv)) out.says_current = true;
      if (/형제|자매|sibling/.test(lv)) out.sibling = true;
      if (/재수강|returning/.test(lv)) out.returning = true;
      out.used[rawHeader] = "할인 구분";
      continue;
    }

    const rule = RULES.find((r) => r.test(h));
    if (!rule) continue;
    const f = rule.field;
    if (f === "weeks") {
      if (out.weeks == null) out.weeks = parseWeeks(v);
    } else if (f === "shuttle") {
      if (out.shuttle == null) out.shuttle = parseShuttle(v);
    } else if (f === "birth_date") {
      if (!out.birth_date) out.birth_date = dateText(v);
    } else if (f === "submitted_at") {
      if (!out.submitted_at && v) {
        const d = new Date(v);
        out.submitted_at = Number.isNaN(d.getTime()) ? null : d.toISOString();
      }
    } else if (f === "applicant_name") {
      if (!out.applicant_name && v) out.applicant_name = v;
    } else {
      const cur = out[f];
      if (!cur && v) (out as Record<string, unknown>)[f] = v;
    }
    out.used[rawHeader] = FIELD_LABEL[f];
  }

  // 주 수를 따로 묻지 않고 「참여 기간」 같은 다른 질문의 대답에만 적힌 폼도 있습니다.
  if (out.weeks == null) {
    for (const v of Object.values(answers)) {
      const w = parseWeeks(String(v ?? ""));
      if (w) {
        out.weeks = w;
        break;
      }
    }
  }
  return out;
}

export const FIELD_LABEL: Record<Field, string> = {
  applicant_name: "학생 이름",
  applicant_name_en: "영문 이름",
  grade: "학년",
  birth_date: "생년월일",
  guardian_name: "보호자 이름",
  guardian_phone: "연락처",
  email: "이메일",
  weeks: "참여 주",
  shuttle: "셔틀",
  submitted_at: "제출 시각",
};
