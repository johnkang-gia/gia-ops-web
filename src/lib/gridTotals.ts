/**
 * **표 위에 뜨는 세 숫자** — 총청구액 · 이미 받은 금액 · 미납 청구액.
 *
 * ── 왜 셋으로 나누나 ────────────────────────────────────────────────────────
 *
 * 예전에는 합계 하나뿐이었습니다. 그 숫자는 「표에 등록된 항목의 값어치」인데, 보는 사람은
 * 「받아야 할 돈」으로 읽습니다. 둘은 다릅니다 - 이미 받은 것이 섞여 있으니까요.
 *
 * 이 화면을 여는 이유의 절반이 **「얼마가 아직 안 들어왔나」**입니다. 그 숫자가 화면에 없으면
 * 수납 화면을 따로 열어 손으로 빼게 되고, 손으로 뺀 숫자는 장부가 아닙니다.
 *
 * ── 무엇을 근거로 세나 ──────────────────────────────────────────────────────
 *
 * · **총청구액** — 표에 등록된 항목의 합. 아직 청구서가 안 나간 것도 포함합니다. 이것이
 *   「이번 학기에 이 아이들에게서 받을 돈 전부」입니다.
 * · **이미 받은 금액** — 입금(`payments`)의 합. 「이미 받음」으로 적어둔 것도 여기 들어갑니다 -
 *   실제로 받은 돈이니까요.
 * · **미납 청구액** — 둘의 차. **음수로 내려가지 않게 막지 않습니다** - 더 받았으면 그 사실이
 *   보여야 합니다. 0으로 눕히면 과납이 화면에서 사라지고, 사라진 돈은 아무도 안 찾습니다.
 *
 * 취소된 장에 붙은 입금은 세지 않습니다. 취소는 「없던 일로 한다」는 뜻입니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

export type TotalsInvoice = {
  id: string;
  student_id: string | null;
  status?: string | null;
};
export type TotalsPayment = { invoice_id: string | null; amount: number | string };

export type GridTotals = {
  /** 표에 등록된 항목의 합. */
  billed: number;
  /** 실제로 들어온 돈. */
  paid: number;
  /** 아직 안 들어온 돈. 더 받았으면 음수입니다. */
  due: number;
};

export function gridTotals(
  /** 지금 화면에 보이는 학생들. 걸러 보고 있으면 그 사람들만 셉니다. */
  studentIds: readonly string[],
  /** 학생 한 명의 등록 항목 합. */
  totalOf: (studentId: string) => number,
  invoices: readonly TotalsInvoice[],
  payments: readonly TotalsPayment[],
): GridTotals {
  const seen = new Set(studentIds);

  // 이 학생들의 살아 있는 장. 취소된 장에 붙은 입금은 세지 않습니다.
  const mine = new Set<string>();
  for (const v of invoices) {
    if (!v.student_id || !seen.has(v.student_id)) continue;
    if ((v.status ?? "") === "취소") continue;
    mine.add(v.id);
  }

  let paid = 0;
  for (const p of payments) {
    if (!p.invoice_id || !mine.has(p.invoice_id)) continue;
    paid += Number(p.amount);
  }

  let billed = 0;
  for (const id of seen) billed += totalOf(id);

  return { billed, paid, due: billed - paid };
}

/**
 * **아이별로 같은 세 숫자.** 표의 오른쪽 세 칸이 이것을 씁니다.
 *
 * 줄마다 `gridTotals` 를 다시 부르면 입금 목록을 학생 수만큼 훑습니다(103명 × 수백 줄).
 * 한 번만 훑고 학생별로 나눠 담습니다 - 답은 같고 읽는 횟수만 줄입니다.
 *
 * 합계 줄의 숫자와 **반드시 같아야 합니다.** 위아래가 다른 숫자를 말하면 그 표는 아무도
 * 안 믿습니다. 그래서 같은 규칙을 두 번 적지 않고, 여기서 낸 값을 더해 합계로 씁니다.
 */
export function gridTotalsByStudent(
  studentIds: readonly string[],
  totalOf: (studentId: string) => number,
  invoices: readonly TotalsInvoice[],
  payments: readonly TotalsPayment[],
): Map<string, GridTotals> {
  const seen = new Set(studentIds);

  // 장 → 학생. 취소된 장에 붙은 입금은 세지 않습니다.
  const ownerOf = new Map<string, string>();
  for (const v of invoices) {
    if (!v.student_id || !seen.has(v.student_id)) continue;
    if ((v.status ?? "") === "취소") continue;
    ownerOf.set(v.id, v.student_id);
  }

  const paidBy = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    const sid = ownerOf.get(p.invoice_id);
    if (!sid) continue;
    paidBy.set(sid, (paidBy.get(sid) ?? 0) + Number(p.amount));
  }

  const out = new Map<string, GridTotals>();
  for (const id of seen) {
    const billed = totalOf(id);
    const paid = paidBy.get(id) ?? 0;
    out.set(id, { billed, paid, due: billed - paid });
  }
  return out;
}
