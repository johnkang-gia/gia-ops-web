/**
 * **이 항목을 이미 청구했는가** — 한 곳에서만 정합니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 학비외에는 이 판정이 **아예 없었습니다.** 그래서 같은 돈이 두 번 나가는 길이 둘 있었습니다.
 *
 * **① 「이미 받음」이 고른 항목만 담지 않았습니다.**
 * 교복 10만원만 체크해도 만들어지는 청구서에는 그 아이의 학비외 항목이 **전부** 담겼습니다.
 * 입금은 체크한 10만원만 붙으니 그 청구서는 일부납으로 남고, 교재비가 미납·연체 목록에
 * 다시 떴습니다 - 이미 받았다고 적어둔 항목이 되돌아오는 것처럼 보입니다.
 *
 * **② 발행이 이미 청구된 항목을 안 걸렀습니다.**
 * 교복을 한 번 청구한 뒤 교재비를 청구하려고 다시 발행하면 교복이 또 담겼습니다. 학부모
 * 화면에는 낼 돈이 두 배로 뜨는데, 오류가 아니라 「청구된 금액」으로 보입니다.
 *
 * 두 구멍의 뿌리는 같습니다 — **무엇이 이미 나갔는지를 아무도 안 셌습니다.**
 *
 * ── 무엇을 근거로 세나 ──────────────────────────────────────────────────────
 *
 * `invoice_lines.name` 입니다. 청구서에 실제로 찍힌 글자가 유일한 사실이고, 항목을 나중에
 * 지우거나 이름을 바꿔도 그때 나간 종이는 안 바뀝니다.
 *
 * **취소된 청구서는 세지 않습니다.** 취소는 「없던 일로 한다」는 뜻이라 그 항목은 다시
 * 청구해야 합니다. 이월된 장(`carried_to_invoice_id`)도 세지 않습니다 - 그 돈은 새 장으로
 * 옮겨갔고, 옮겨간 장이 따로 세어집니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

/** 받았는가. 청구서 단위로 봅니다 - 입금은 청구서에 붙지 줄에 붙지 않습니다. */
export type BillState = "완납" | "일부" | "미납";

export type BilledInvoice = {
  id: string;
  student_id: string | null;
  status?: string | null;
  total_amount: number | string;
  carried_to_invoice_id?: string | null;
};

export type BilledLine = { invoice_id: string; name: string };
export type BilledPayment = { invoice_id: string | null; amount: number | string };

export type BilledMark = {
  state: BillState;
  /** 어느 청구서에 담겼나. 화면이 「그 청구서 보기」로 이어줍니다. */
  invoiceId: string;
};

/**
 * 학생 → 항목 이름 → 그 항목이 어느 청구서에 담겼고 걷혔는가.
 *
 * 같은 항목이 여러 장에 있으면 **덜 걷힌 쪽이 사실입니다.** 완납으로 덮으면 아직 안 받은
 * 돈이 화면에서 사라지고, 사라진 돈은 아무도 안 찾습니다.
 */
export function billedItems(
  invoices: readonly BilledInvoice[],
  lines: readonly BilledLine[],
  payments: readonly BilledPayment[],
): Map<string, Map<string, BilledMark>> {
  const paidBy = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Number(p.amount));
  }

  const alive = new Map<string, BilledInvoice>();
  for (const v of invoices) {
    if (!v.student_id) continue;
    if ((v.status ?? "") === "취소") continue;
    if (v.carried_to_invoice_id) continue;
    alive.set(v.id, v);
  }

  const out = new Map<string, Map<string, BilledMark>>();
  for (const l of lines) {
    const inv = alive.get(l.invoice_id);
    if (!inv || !inv.student_id) continue;
    const total = Number(inv.total_amount);
    const paid = paidBy.get(inv.id) ?? 0;
    const state: BillState = paid <= 0 ? "미납" : paid >= total ? "완납" : "일부";

    const per = out.get(inv.student_id) ?? out.set(inv.student_id, new Map()).get(inv.student_id)!;
    const cur = per.get(l.name);
    // 덜 걷힌 쪽이 이깁니다. 미납 > 일부 > 완납 순으로 셉니다.
    if (!cur || rank(state) > rank(cur.state)) per.set(l.name, { state, invoiceId: inv.id });
  }
  return out;
}

function rank(s: BillState): number {
  return s === "미납" ? 2 : s === "일부" ? 1 : 0;
}

/**
 * 아직 청구서에 안 담긴 항목만 골라냅니다.
 *
 * **발행과 「이미 받음」이 같은 이 함수를 씁니다.** 두 곳이 각자 세면 한쪽만 고쳐지는 날이
 * 오고, 그날 같은 돈이 두 번 나갑니다.
 */
export function unbilledNames(
  wanted: readonly string[],
  marks: Map<string, BilledMark> | undefined,
): string[] {
  if (!marks) return [...wanted];
  return wanted.filter((n) => !marks.has(n));
}

/** 화면에 붙이는 말. 색은 화면이 정하고, 말은 여기서 한 번만 정합니다. */
export const BILL_LABEL: Record<BillState, string> = {
  완납: "받음",
  일부: "일부받음",
  미납: "청구됨",
};
