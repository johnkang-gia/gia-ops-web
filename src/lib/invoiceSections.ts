/**
 * **한 장에 여럿을 담을 때 칸을 무엇으로 나누는가** — 한 곳에서만 정합니다.
 *
 * 한 장짜리 청구서에 여러 장이 들어가는 경우가 둘입니다.
 *
 *   · **형제 합본** — 보호자 번호가 같아 한 장으로 보내는 집. 칸은 **아이 이름**으로 나눕니다.
 *     「악기비 12만원」이 형 것인지 동생 것인지 알 수 없으면 그 집이 물어보고, 행정실은 두
 *     장을 다시 찾아 더해 설명해야 합니다.
 *   · **학비 + 학비외 합본** — 한 아이의 두 장을 한 장으로. 칸은 **갈래**로 나눕니다.
 *     아이 이름으로 나누면 같은 이름이 두 번 찍혀서, 보는 사람은 왜 두 칸인지 모릅니다.
 *
 * 둘은 같은 종이인데 나누는 기준만 다릅니다. 기준을 종이 쪽에서 매번 다시 정하면, 새 합본이
 * 생길 때마다 「이건 이름으로, 저건 갈래로」가 또 늘어납니다.
 *
 * 학부모에게 나가는 종이라 **영문을 본문으로** 씁니다(양식이 영문입니다). 한글은 괄호 안에.
 */

export type SectionInvoice = {
  student_id?: string | null;
  student_name?: string | null;
  student_name_ko?: string | null;
  grade_label?: string | null;
  invoice_no?: string | null;
  /** 학비 / 학비외. 옛 줄은 비어 있어 분류로 되짚습니다. */
  stream?: string | null;
  category?: string | null;
};

/** 갈래 이름. 화면·종이가 같은 말을 씁니다. */
export const STREAM_TITLE: Record<string, string> = {
  학비: "School Tuition (학비)",
  학비외: "Textbook & Materials (학비외)",
};

/** 이 장이 어느 갈래인가. `stream` 이 비어 있으면 분류로 되짚습니다(옛 줄). */
export function streamOf(inv: SectionInvoice): "학비" | "학비외" {
  const s = (inv.stream ?? "").trim();
  if (s === "학비" || s === "학비외") return s;
  // 분류가 적혀 있으면 학비외입니다 - 학비에는 분류 칸을 안 씁니다.
  return (inv.category ?? "").trim() ? "학비외" : "학비";
}

/** 아이 이름(반). */
export function whoOf(inv: SectionInvoice): string {
  const name = (inv.student_name_ko?.trim() || inv.student_name || "").trim();
  const g = (inv.grade_label ?? "").trim();
  return g ? `${name} · ${g}` : name;
}

export type SectionMode = "없음" | "학생별" | "갈래별";

/**
 * **칸을 무엇으로 나눌지 정합니다.**
 *
 * 아이가 여럿이면 이름으로, 한 아이의 여러 장이면 갈래로, 한 장이면 나누지 않습니다.
 * 한 장짜리에 머리줄과 소계를 붙이면 총액과 같은 숫자가 두 번 찍힙니다.
 */
export function sectionMode(invoices: readonly SectionInvoice[]): SectionMode {
  if (invoices.length <= 1) return "없음";
  const students = new Set(invoices.map((v) => v.student_id ?? whoOf(v)));
  return students.size > 1 ? "학생별" : "갈래별";
}

/** 그 칸의 머리줄 글자. */
export function sectionTitle(inv: SectionInvoice, mode: SectionMode): string {
  if (mode === "갈래별") return STREAM_TITLE[streamOf(inv)] ?? streamOf(inv);
  return whoOf(inv);
}

/** 그 칸의 소계에 붙일 이름. */
export function sectionSubtotalLabel(inv: SectionInvoice, mode: SectionMode): string {
  if (mode === "갈래별") return `${STREAM_TITLE[streamOf(inv)] ?? streamOf(inv)} 소계`;
  return `${(inv.student_name_ko?.trim() || inv.student_name || "").trim()} 소계`;
}

/**
 * **한 장에 담을 순서.** 학비가 먼저입니다 — 금액이 크고, 학부모가 먼저 확인하는 것도
 * 학비입니다. 같은 갈래가 여럿이면 청구서 번호 순으로 둡니다(만든 순서).
 */
export function sortForSheet<T extends SectionInvoice>(invoices: readonly T[]): T[] {
  const rank = (v: T) => (streamOf(v) === "학비" ? 0 : 1);
  return [...invoices].sort(
    (a, b) => rank(a) - rank(b) || (a.invoice_no ?? "").localeCompare(b.invoice_no ?? ""),
  );
}
