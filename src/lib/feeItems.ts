import type { FeeItem, StudentFeeItem } from "@/lib/types";

// "이 아이는 무엇을 사는가"를 정하는 규칙 한 곳.
//
// 화면(체크 목록)과 발행(인보이스 줄)이 이 답을 서로 다르게 내면, 담당자가 화면에서 본 것과
// 학부모가 받는 종이가 달라집니다. 그래서 함수 하나로 모읍니다.
//
// 규칙은 두 줄입니다.
//   1. 항목에 적힌 기본 대상(학년·반)에 들면 산다.
//   2. 그 아이에게 따로 적힌 결정(include/exclude)이 있으면 **그쪽이 이긴다.**
//
// 2번이 1번을 이기는 이유: 기본 세트는 짐작이고, 아이별 기록은 사람이 확인해서 적은 것입니다.
// 사람이 확인한 것을 짐작이 뒤집으면 아무도 그 화면을 안 믿게 됩니다.

export type StudentLike = { id: string; grade: string | null; className: string | null };

/** 학년 표기가 "5", "5학년", "G5" 등으로 섞여 들어와도 같게 봅니다. */
function normGrade(v: string | null | undefined): string {
  return (v ?? "").toString().trim().replace(/^G/i, "").replace(/학년$/, "").trim();
}

function normClass(v: string | null | undefined): string {
  return (v ?? "").toString().trim().toUpperCase();
}

/** 이 항목이 이 아이에게 **기본으로** 붙는가(아이별 결정을 보기 전). */
export function isDefaultFor(item: FeeItem, s: StudentLike): boolean {
  const g = normGrade(s.grade);
  const c = normClass(s.className);
  const byGrade = (item.default_grades ?? []).some((x) => normGrade(x) === g && g !== "");
  const byClass = (item.default_classes ?? []).some((x) => normClass(x) === c && c !== "");
  return byGrade || byClass;
}

export type ResolvedLine = {
  item: FeeItem;
  qty: number;
  amount: number;
  /** 기본 세트로 들어왔는가, 사람이 따로 넣었는가. 화면에서 구분해 보여줍니다. */
  fromDefault: boolean;
};

/**
 * 이 아이가 오늘 사는 것들. 인보이스 줄이 되는 목록입니다.
 *
 * @param overrides 이 아이에 대한 include/exclude 기록
 */
export function resolveStudentItems(
  items: FeeItem[],
  s: StudentLike,
  overrides: StudentFeeItem[],
): ResolvedLine[] {
  const byItem = new Map(overrides.filter((o) => o.student_id === s.id).map((o) => [o.item_id, o]));
  const out: ResolvedLine[] = [];
  for (const item of items) {
    if (!item.active) continue;
    const o = byItem.get(item.id);
    const included = o ? o.mode === "include" : isDefaultFor(item, s);
    if (!included) continue;
    const qty = Math.max(1, o?.qty ?? 1);
    out.push({
      item,
      qty,
      // 금액은 여기서만 계산합니다. 사람이 손으로 쓰는 자리를 아예 만들지 않습니다.
      amount: Math.round(Number(item.unit_price) * qty),
      fromDefault: !o && isDefaultFor(item, s),
    });
  }
  return out.sort(
    (a, b) =>
      a.item.category.localeCompare(b.item.category, "ko") ||
      a.item.sort_order - b.item.sort_order ||
      a.item.name.localeCompare(b.item.name),
  );
}

export function sumLines(lines: { amount: number }[]): number {
  return lines.reduce((n, l) => n + l.amount, 0);
}

/** ₩191,000 */
export function won(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

/** 인보이스에 찍는 학년 표기. "Grade 5" / "G5E". */
export function gradeLabel(s: { grade: string | null; className: string | null }): string {
  const g = normGrade(s.grade);
  if (!g) return s.className ?? "";
  return s.className ? `Grade ${g} · ${s.className}` : `Grade ${g}`;
}
