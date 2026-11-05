import { normName } from "@/lib/studentDuplicates";

/**
 * **캠프 신청서 한 줄 ↔ 명부의 학생** 을 자동으로 잇는 판정. 순수 함수입니다(시험: scripts/test-camp-fee.ts).
 *
 * 구글폼 응답이 수십 장씩 들어오는데 한 줄씩 «명부에 같은 이름 — 누르세요»를 눌러야 했습니다. 대부분은 이름이
 * 하나뿐인 재학생이라 사람이 고를 것이 없습니다. 그래서 **확실한 경우만** 저절로 잇고, 나머지는 지금처럼 사람이
 * 고릅니다. 동명이인을 잘못 이으면 남의 아이에게 청구서가 나갑니다(CLAUDE.md 2-4-1) - 애매하면 잇지 않습니다.
 *
 *   · 한글 이름이 같은 학생이 한 명뿐 → 그 학생 (생일이 둘 다 있고 다르면 잇지 않음)
 *   · 같은 이름이 여럿(동명이인·옛 중복 줄) → 근거가 있는 한 명으로 좁혀질 때만, 이 순서로:
 *       ① 보호자 전화번호가 명부의 보호자·결제 번호와 같은 한 명
 *       ② 생일이 같은 한 명
 *       ③ «재학생이라고 답했고» 재학생이 한 명뿐
 *     생일이 «비어 있어서» 남은 한 명은 근거가 아닙니다. 박세주는 재학생(G2A) 줄과 반·생일이 빈 옛 퇴소 줄이
 *     있었는데, 생일이 하루 어긋나 들어온 날 재학생 줄이 빠지고 빈 옛 줄 하나만 남아 그쪽에 이어졌습니다.
 *   · 한글 이름으로 못 찾으면 영문 이름이 같은 한 명
 *   · 그 밖에는 null (사람이 고름)
 */

export type MatchRosterRow = {
  id: string;
  name: string;
  name_en?: string | null;
  birth_date?: string | null;
  status?: string | null;
  mother_phone?: string | null;
  father_phone?: string | null;
  parent_phone?: string | null;
  billing_phone?: string | null;
};
export type MatchApp = {
  applicant_name: string | null;
  applicant_name_en?: string | null;
  birth_date?: string | null;
  says_current?: boolean | null;
  guardian_phone?: string | null;
};
export type MatchResult =
  | { studentId: string; by: "이름" | "이름+생일" | "이름+전화" | "이름+재학" | "영문 이름" }
  | { ambiguous: number }
  | null;

const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 전화번호를 비교할 수 있는 모양으로: 숫자만, +82 → 0. 8자리 미만은 번호로 보지 않습니다. */
export function phoneKey(v: string | null | undefined): string | null {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  return d.length >= 8 ? d : null;
}

function phonesOf(s: MatchRosterRow): Set<string> {
  const out = new Set<string>();
  for (const v of [s.mother_phone, s.father_phone, s.parent_phone, s.billing_phone]) {
    const k = phoneKey(v);
    if (k) out.add(k);
  }
  return out;
}

/** 같은 이름 후보 여럿 → 근거로 한 명 고르기. 못 고르면 null. */
function narrow(app: MatchApp, cands: MatchRosterRow[], birth: string | null): MatchResult {
  const phone = phoneKey(app.guardian_phone);
  if (phone) {
    const byPhone = cands.filter((s) => phonesOf(s).has(phone));
    if (byPhone.length === 1) return { studentId: byPhone[0].id, by: "이름+전화" };
    if (byPhone.length > 1) cands = byPhone; // 형제가 아니라 같은 이름 둘이 같은 번호 - 아래 근거로 더 좁힘
  }
  if (birth) {
    const exact = cands.filter((s) => s.birth_date === birth);
    if (exact.length === 1) return { studentId: exact[0].id, by: "이름+생일" };
  }
  if (app.says_current) {
    // 생일이 둘 다 있고 다르면 다른 아이이므로 뺍니다.
    const active = cands.filter((s) => s.status === "active" && (!birth || !isDate(s.birth_date) || s.birth_date === birth));
    if (active.length === 1) return { studentId: active[0].id, by: "이름+재학" };
  }
  return null;
}

export function matchCampStudent(app: MatchApp, roster: readonly MatchRosterRow[]): MatchResult {
  const k = normName(app.applicant_name);
  const birth = isDate(app.birth_date) ? app.birth_date : null;
  // 생일이 둘 다 있고 다르면 다른 아이입니다.
  const birthOk = (s: MatchRosterRow) => !birth || !isDate(s.birth_date) || s.birth_date === birth;

  if (k) {
    const all = roster.filter((s) => normName(s.name) === k);
    if (all.length === 1) {
      const s = all[0];
      if (birthOk(s)) return { studentId: s.id, by: birth && s.birth_date === birth ? "이름+생일" : "이름" };
    } else if (all.length > 1) {
      const m = narrow(app, all, birth);
      if (m) return m;
      // 생일로 걸러 한 명만 남아도, 그 한 명이 «생일이 같아서» 남은 것이 아니면 근거가 없습니다.
      return { ambiguous: all.length };
    }
  }

  const ke = normName(app.applicant_name_en);
  if (ke) {
    const en = roster.filter((s) => normName(s.name_en) === ke).filter(birthOk);
    if (en.length === 1) return { studentId: en[0].id, by: "영문 이름" };
    if (en.length > 1) {
      const m = narrow(app, en, birth);
      if (m) return { ...m, by: "영문 이름" } as MatchResult;
      return { ambiguous: en.length };
    }
  }
  return null;
}

/** 이어진 학생으로 «재학생/외부»를 가릅니다. 아직 안 이었으면 폼의 답(재학 여부)을 씁니다. */
export function campGroupOf(linkedStatus: string | null | undefined, saysCurrent: boolean | null | undefined): "재학생" | "외부" {
  if (linkedStatus) return linkedStatus === "active" ? "재학생" : "외부";
  return saysCurrent ? "재학생" : "외부";
}

/** 폼에는 «재학생»이라 답했는데 이어진 학생이 재학생이 아님 - 잘못 이었을 가능성이 큽니다. 화면이 띄웁니다. */
export function campLinkSuspect(linkedStatus: string | null | undefined, saysCurrent: boolean | null | undefined): boolean {
  return !!linkedStatus && linkedStatus !== "active" && !!saysCurrent;
}
