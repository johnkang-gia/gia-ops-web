import { departmentOf } from "@/lib/department";
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

export type StudentLike = { id: string; grade: string | null; className: string | null; department?: string | null };

/**
 * 이 항목이 이 아이의 부서에 쓰이는가.
 *
 * 초등과 중고등은 사는 교재가 아예 다릅니다. 항목의 부서가 비어 있으면 양쪽 모두에 쓰는
 * 것입니다(교복처럼 학교 전체가 사는 것). 이 판단이 없으면 중고등 교재가 초등 아이 줄에
 * 붙을 수 있는 자리가 생깁니다.
 */
export function inDepartment(item: FeeItem, s: StudentLike): boolean {
  if (!item.department) return true;
  return departmentOf({ department: s.department ?? null, grade: s.grade }) === item.department;
}

/** 학년 표기가 "5", "5학년", "G5" 등으로 섞여 들어와도 같게 봅니다. */
function normGrade(v: string | null | undefined): string {
  return (v ?? "").toString().trim().replace(/^G/i, "").replace(/학년$/, "").trim();
}

function normClass(v: string | null | undefined): string {
  return (v ?? "").toString().trim().toUpperCase();
}

/**
 * 이 항목의 **대상**에 이 아이가 드는가. 자동으로 붙는지와는 다릅니다.
 *
 * 대상은 "누구를 위한 항목인가" 만 뜻합니다 — 3학년 중국어책은 3학년 것이지만, 3학년
 * 전원이 사는 것은 아닙니다.
 */
export function inTarget(item: FeeItem, s: StudentLike): boolean {
  if (!inDepartment(item, s)) return false;

  // 부서 전원(교복). 학년이 늘어도 저절로 따라옵니다 - 학년을 하나씩 체크해 두면 그 목록은
  // 체크하던 날의 사진이라, 다음 학기에 새 학년이 조용히 빠집니다.
  if (item.target_scope === "부서전체") return true;
  if (item.target_scope === "개별") return false;

  const g = normGrade(s.grade);
  const c = normClass(s.className);
  const byGrade = (item.default_grades ?? []).some((x) => normGrade(x) === g && g !== "");
  const byClass = (item.default_classes ?? []).some((x) => normClass(x) === c && c !== "");

  // 반까지 정한 항목은 **둘 다** 맞아야 합니다.
  //
  // 예전에는 둘 중 하나만 맞아도 붙었습니다. 그래서 `4학년 G4R` 로 적어둔 교재가 5학년
  // G4R(같은 반 이름을 다른 학년이 쓰는 경우)에도 붙을 수 있었습니다. "그 학년의 그 반"
  // 이라고 적은 것이니 그대로 읽습니다.
  if (item.target_scope === "반") return byGrade && byClass;

  // 옛 자료(칸이 없던 시절)는 예전대로 - 둘 중 하나만 맞아도 붙습니다.
  return byGrade || byClass;
}

/**
 * 이 항목이 이 아이에게 **자동으로** 붙는가(아이별 결정을 보기 전).
 *
 * 대상에 들더라도 `auto_apply` 가 꺼져 있으면 자동으로 붙지 않습니다.
 *
 *   auto_apply = true   3학년 공통 교과서 — 3학년이면 전원
 *   auto_apply = false  3학년 중국어      — 3학년 중에 **고른 아이만**
 *
 * 이 둘을 한 칸에 섞어두면 둘 중 하나를 하게 됩니다. 전원에게 붙인 뒤 안 하는 아이를 하나씩
 * 빼거나(빼는 것을 잊으면 **돈이 잘못 청구됩니다**), 대상을 비우고 하나씩 넣거나(그러면 이
 * 항목이 3학년 것이라는 사실이 어디에도 안 남아 표에서 걸러낼 수가 없습니다).
 *
 * 칸이 없던 시절 자료(auto_apply 가 undefined)는 **true 로 봅니다.** 지금 붙어 있는 것이
 * 그대로 유지되어야 합니다 - 여기서 false 로 읽으면 이미 청구한 항목이 한꺼번에 사라집니다.
 */
export function isDefaultFor(item: FeeItem, s: StudentLike): boolean {
  if (item.auto_apply === false) return false;
  return inTarget(item, s);
}

/**
 * 이 항목이 **누구를 위한 것인가**를 한 줄로.
 *
 * 지금까지는 이것을 이름에 적었습니다 — `4학년 중국어`. 그러면 세 가지가 어긋납니다.
 *   · 인보이스에 `4학년 중국어` 가 그대로 찍힙니다(학부모에게는 필요 없는 말입니다)
 *   · 학년이 바뀌면 이름을 고쳐야 하는데, 고치면 지난 청구서와 이름이 달라집니다
 *   · 글자로만 적혀 있어서 **기계는 못 읽습니다** — 표에서 걸러낼 수가 없습니다
 *
 * 대상은 이름이 아니라 칸(default_grades·default_classes)에 둡니다. 그러면 화면이 뱃지로
 * 보여줄 수 있고, 상관없는 명단에서는 열을 아예 세우지 않을 수 있습니다.
 */
export function targetLabel(item: Pick<FeeItem, "default_grades" | "default_classes"> & { target_scope?: string | null }): string {
  if (item.target_scope === "부서전체") return "전체";
  if (item.target_scope === "개별") return "개별 지정";
  const g = (item.default_grades ?? []).map(normGrade).filter(Boolean);
  const c = (item.default_classes ?? []).filter(Boolean);
  if (g.length === 0 && c.length === 0) return "개별 지정";
  const parts: string[] = [];
  // 학년은 숫자 순으로. 이름 순으로 두면 10학년이 2학년 앞에 옵니다.
  if (g.length > 0) parts.push(`${[...g].sort((a, b) => Number(a) - Number(b)).join("·")}학년`);
  if (c.length > 0) parts.push([...c].sort((a, b) => a.localeCompare(b, "ko")).join("·"));
  return parts.join(" ");
}

/**
 * 이 항목이 **지금 보고 있는 명단**과 상관이 있는가.
 *
 * 인보이스 표는 항목 하나가 열 하나입니다. 항목이 늘수록 표가 가로로 한없이 길어지는데,
 * 그중 대부분은 지금 명단과 아무 상관이 없습니다 — G2A 를 보는 중에 `4학년 중국어` 열이
 * 서 있을 이유가 없습니다.
 *
 * 대상이 비어 있는 항목(개별 지정)은 **언제나 상관있는 것으로 봅니다.** 어느 아이에게나
 * 손으로 붙일 수 있는 것이라, 여기서 걸러내면 붙일 방법이 없어집니다.
 */
export function appliesToAny(item: FeeItem, list: StudentLike[]): boolean {
  if (item.target_scope === "개별") return true;
  const hasTarget = item.target_scope === "부서전체" || (item.default_grades ?? []).length > 0 || (item.default_classes ?? []).length > 0;
  if (!hasTarget) return true;
  // **자동으로 붙는지가 아니라 대상에 드는지**를 봅니다.
  //
  // 3학년 중국어는 자동으로 안 붙지만 3학년 표에는 열이 서야 합니다 - 거기서 하는 아이를
  // 골라야 하니까요. isDefaultFor 로 보면 그 열이 아예 안 서서 고를 방법이 없어집니다.
  return list.some((s) => inTarget(item, s));
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
    // 부서가 다른 항목은 아이별로 넣어둔 것이 있어도 붙이지 않습니다. 중고등 교재를 초등
    // 아이에게 실수로 체크해둔 것이 그대로 청구되면 안 됩니다.
    if (!inDepartment(item, s)) continue;
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
