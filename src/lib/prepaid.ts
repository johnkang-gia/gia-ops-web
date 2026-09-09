/**
 * **청구서보다 먼저 들어온 돈** — 한 곳에서만 셉니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 지금까지 결제 체크는 **청구서가 있어야만** 할 수 있었습니다. 그런데 이미 낸 학부모가
 * 있습니다 - 청구서를 만들기 전에 계좌로 보내신 분, 학기 초에 한꺼번에 내신 분.
 * 그 돈을 넣을 자리가 없어서, 담당자는 종이나 머릿속에 따로 적어두게 됩니다.
 *
 * ── 다른 곳은 어떻게 하나 ────────────────────────────────────────────
 *
 * 회계 프로그램(QuickBooks·Xero)과 결제사(Stripe)가 공통으로 쓰는 방식은 하나입니다.
 * **청구서와 입금은 별개의 기록이고, 둘을 잇는 것이 「충당」입니다.** 청구서 없이 들어온
 * 돈은 그 사람 앞으로 남아 있다가(선수금), 나중에 청구서가 생기면 거기에 붙습니다.
 *
 * 우리 `payments` 표는 이미 그렇게 생겼습니다 - `invoice_id` 가 비어 있어도 됩니다.
 * 없던 것은 **붙이는 규칙**뿐이라, 그걸 여기 둡니다.
 *
 * ── 쪼개는 것을 왜 허용하나 ──────────────────────────────────────────
 *
 * 50만원을 먼저 내신 분에게 30만원짜리 청구서가 나가면, 「금액이 안 맞으니 못 붙인다」로
 * 두면 그 청구서는 영영 미납으로 남습니다. 그래서 30만원만 붙이고 20만원은 **남은
 * 선입금으로 그대로 둡니다.** 다만 쪼갠 사실은 메모에 남깁니다 - 통장 한 줄이 우리 표에서
 * 두 줄이 된 이유를 나중에 설명할 수 있어야 합니다.
 */

export type PrepaidPayment = {
  id: string;
  /** 아직 어느 청구서에도 안 붙은 돈만 여기 옵니다. */
  amount: number;
  paidAt: string;
  payerName?: string | null;
};

/** 이 학생 앞으로 남아 있는 선입금 합계. */
export function prepaidBalance(list: PrepaidPayment[]): number {
  return list.reduce((n, p) => n + p.amount, 0);
}

export type ApplyPlan = {
  /** 통째로 붙일 입금. */
  whole: string[];
  /** 일부만 붙일 입금 하나. 나머지는 새 줄로 남습니다. */
  split: { id: string; applied: number; leftover: number } | null;
  /** 이번에 붙는 총액. */
  applied: number;
};

/**
 * 남은 선입금을 이 청구서에 붙이는 계획을 짭니다. **먼저 들어온 돈부터** 씁니다.
 *
 * 먼저 들어온 것부터 쓰는 이유: 돈에는 이름이 없지만 순서는 있습니다. 나중 것을 먼저
 * 쓰면 「그때 낸 돈은 어디 갔나」를 설명할 수 없습니다.
 *
 * 계획만 돌려주고 저장은 부르는 쪽이 합니다 - 그래야 시험할 수 있습니다.
 */
export function planApply(list: PrepaidPayment[], invoiceTotal: number): ApplyPlan {
  const plan: ApplyPlan = { whole: [], split: null, applied: 0 };
  if (invoiceTotal <= 0) return plan;

  const ordered = [...list].sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.id.localeCompare(b.id));
  let left = invoiceTotal;

  for (const p of ordered) {
    if (left <= 0) break;
    if (p.amount <= left) {
      plan.whole.push(p.id);
      plan.applied += p.amount;
      left -= p.amount;
      continue;
    }
    // 남은 자리보다 큰 입금 - 여기까지만 붙이고 나머지는 남겨둡니다.
    plan.split = { id: p.id, applied: left, leftover: p.amount - left };
    plan.applied += left;
    left = 0;
    break;
  }
  return plan;
}

/** 쪼갠 줄에 남길 말. 통장 한 줄이 왜 두 줄이 됐는지 나중에 설명할 수 있어야 합니다. */
export function splitMemo(original: number, applied: number, invoiceNo: string): string {
  return `선입금 ${original.toLocaleString("ko-KR")}원 중 ${applied.toLocaleString("ko-KR")}원을 ${invoiceNo} 에 충당`;
}
