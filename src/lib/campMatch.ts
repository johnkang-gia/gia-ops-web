import { normName } from "@/lib/studentDuplicates";

/**
 * **캠프 신청서 한 줄 ↔ 명부의 학생** 을 자동으로 잇는 판정. 순수 함수입니다(시험: scripts/test-camp-fee.ts).
 *
 * 구글폼 응답이 수십 장씩 들어오는데 한 줄씩 «명부에 같은 이름 — 누르세요»를 눌러야 했습니다. 대부분은 이름이
 * 하나뿐인 재학생이라 사람이 고를 것이 없습니다. 그래서 **확실한 경우만** 저절로 잇고, 나머지는 지금처럼 사람이
 * 고릅니다. 동명이인을 잘못 이으면 남의 아이에게 청구서가 나갑니다(CLAUDE.md 2-4-1) - 애매하면 잇지 않습니다.
 *
 *   · 한글 이름이 같은 학생이 한 명뿐 → 그 학생 (생일이 둘 다 있고 다르면 잇지 않음)
 *   · 같은 이름이 여럿 → 생일이 같은 한 명으로 좁혀질 때만, 또는 «재학생이라고 답했고» 재학생이 한 명뿐일 때만
 *   · 한글 이름으로 못 찾으면 영문 이름이 같은 한 명
 *   · 그 밖에는 null (사람이 고름)
 */

export type MatchRosterRow = { id: string; name: string; name_en?: string | null; birth_date?: string | null; status?: string | null };
export type MatchApp = { applicant_name: string | null; applicant_name_en?: string | null; birth_date?: string | null; says_current?: boolean | null };
export type MatchResult = { studentId: string; by: "이름" | "이름+생일" | "이름+재학" | "영문 이름" } | { ambiguous: number } | null;

const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function matchCampStudent(app: MatchApp, roster: readonly MatchRosterRow[]): MatchResult {
  const k = normName(app.applicant_name);
  const birth = isDate(app.birth_date) ? app.birth_date : null;
  // 생일이 둘 다 있고 다르면 다른 아이입니다.
  const birthOk = (s: MatchRosterRow) => !birth || !isDate(s.birth_date) || s.birth_date === birth;

  if (k) {
    const same = roster.filter((s) => normName(s.name) === k).filter(birthOk);
    if (same.length === 1) {
      const s = same[0];
      return { studentId: s.id, by: birth && s.birth_date === birth ? "이름+생일" : "이름" };
    }
    if (same.length > 1) {
      if (birth) {
        const exact = same.filter((s) => s.birth_date === birth);
        if (exact.length === 1) return { studentId: exact[0].id, by: "이름+생일" };
      }
      if (app.says_current) {
        const active = same.filter((s) => s.status === "active");
        if (active.length === 1) return { studentId: active[0].id, by: "이름+재학" };
      }
      return { ambiguous: same.length };
    }
  }

  const ke = normName(app.applicant_name_en);
  if (ke) {
    const en = roster.filter((s) => normName(s.name_en) === ke).filter(birthOk);
    if (en.length === 1) return { studentId: en[0].id, by: "영문 이름" };
    if (en.length > 1) return { ambiguous: en.length };
  }
  return null;
}

/** 이어진 학생으로 «재학생/외부»를 가릅니다. 아직 안 이었으면 폼의 답(재학 여부)을 씁니다. */
export function campGroupOf(linkedStatus: string | null | undefined, saysCurrent: boolean | null | undefined): "재학생" | "외부" {
  if (linkedStatus) return linkedStatus === "active" ? "재학생" : "외부";
  return saysCurrent ? "재학생" : "외부";
}
