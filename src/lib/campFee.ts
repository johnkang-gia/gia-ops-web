import { kstDate } from "./kst";
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
  /** 학부모가 «기타 문의»에 적은 글. 「2주차부터 참석」·「동생도 신청」처럼 금액을 바꾸는 말이 여기 옵니다. */
  note: string | null;
  /** 폼에 참여 주를 묻는 질문이 없어 3주(전체)로 둔 경우. 화면이 «확인 필요»로 보여줍니다. */
  weeks_assumed: boolean;
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
  // 시트의 날짜 칸은 앱스크립트가 **시각까지 붙은 세계표준시**로 보냅니다(한국 자정 = 전날 15:00Z). 앞 10글자만 자르면
  // 생일이 하루씩 앞당겨져 명부와 안 맞았습니다 - 시각이 붙은 값은 한국 날짜로 바꿉니다.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return kstDate(d);
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = t.match(/(\d{4})\s*[.\/년-]\s*(\d{1,2})\s*[.\/월-]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return t;
}

type Field = keyof Omit<CampForm, "used" | "says_current" | "sibling" | "returning" | "note" | "weeks_assumed">;

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
  { field: "weeks", test: (h) => /(주|week|기간)/.test(h) && /(참여|기간|신청|과정|선택|week)/.test(h) && !/셔틀|차량|문의|question|주소|address/.test(h) },
  { field: "shuttle", test: (h) => /셔틀|차량|shuttle|bus/.test(h) && !/주소|address/.test(h) },
  { field: "applicant_name", test: (h) => /(이름|성명|name)/.test(h) && !/학교|school/.test(h) },
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
    note: null,
    weeks_assumed: false,
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
    // 「GIA 캠프가 처음입니까?」 - 아니오면 재수강입니다(2027 윈터캠프 폼).
    if (/처음|first time/.test(h)) {
      if (/^(아니|no)/i.test(lv)) out.returning = true;
      out.used[rawHeader] = "재수강 여부(처음인가)";
      continue;
    }
    // 「어떤 경로로 알게 되셨나요?」의 «재학생 학부모»는 재학생이라는 대답입니다. 실제 할인은 연결한 학생의 명부 상태로 정합니다.
    if (/경로|hear about/.test(h)) {
      if (/current gia parent|재학생 학부모/.test(lv)) out.says_current = true;
      out.used[rawHeader] = "알게 된 경로";
      continue;
    }
    // 기타 문의 칸. 형제 언급이면 형제 표시를 켭니다(사람이 화면에서 확인). 글은 그대로 남깁니다.
    if (/문의|question|comment/.test(h)) {
      if (v) out.note = v;
      if (/동생|형제|자매|누나|언니|오빠|sibling|brother|sister/.test(lv)) out.sibling = true;
      out.used[rawHeader] = "기타 문의";
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

  // 참여 주를 묻는 질문이 아예 없는 폼(2027 윈터캠프)은 전체 3주로 둡니다. 2주만 오는 집은 «기타 문의»에 적어 오므로
  // 화면이 그 글을 함께 보여주고, 사람이 2주로 바꿉니다. 기타 문의 글에서 주 수를 짐작하지는 않습니다 - 「week1은 못 옴」을
  // 1주로 읽는 식의 오독이 금액을 바꿉니다.
  if (out.weeks == null) {
    out.weeks = 3;
    out.weeks_assumed = true;
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

// ── 추가 금액(셔틀 추가 요금 등) ───────────────────────────────────────────

/** 수강료 말고 따로 받는 금액 한 줄. 청구서에는 수강료 다음 줄로 각각 찍힙니다. */
export type CampExtra = { name: string; amount: number };

/**
 * 화면·폼에서 온 값을 안전한 목록으로 바꿉니다. 이름이 비었거나 금액이 0 이하·숫자 아님이면 뺍니다.
 * 뺀 줄이 있으면 `dropped` 로 알려서 조용히 사라지지 않게 합니다(CLAUDE.md §5).
 */
export function normalizeExtras(v: unknown): { extras: CampExtra[]; dropped: number } {
  if (!Array.isArray(v)) return { extras: [], dropped: 0 };
  const out: CampExtra[] = [];
  let dropped = 0;
  for (const x of v) {
    const name = String((x as { name?: unknown })?.name ?? "").trim();
    const amount = Number((x as { amount?: unknown })?.amount);
    if (name && Number.isFinite(amount) && amount > 0) out.push({ name: name.slice(0, 60), amount: Math.round(amount) });
    else dropped++;
  }
  return { extras: out, dropped };
}

export function extrasTotal(extras: readonly CampExtra[] | null | undefined): number {
  return (extras ?? []).reduce((n, e) => n + e.amount, 0);
}
