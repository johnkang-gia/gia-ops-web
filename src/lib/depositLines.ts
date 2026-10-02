/**
 * **예치금을 항목에 붙이는 규칙** — 계산만 하고 저장은 하지 않습니다(시험할 수 있게).
 *
 * 예치금 차감은 지금까지 청구서 합계에서 금액만 깎았습니다. 학부모에게 가는 종이에
 * 「무엇을 예치금에서 냈는지」를 적으려면, 뺄 때부터 **항목 단위로** 빼야 합니다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────
 *
 *   · 예치금은 **먼저 들어온 돈부터** 씁니다(`prepaid.ts` 와 같은 이유).
 *   · 항목은 **고른 순서대로** 덮습니다. 예치금이 모자라면 마지막 항목만 일부를 덮고,
 *     그 사실을 계획에 남깁니다(`partial`). 화면은 그것을 사람에게 먼저 보여줍니다.
 *   · 한 항목을 예치금 두 줄이 나눠 덮을 수 있습니다. 그래서 항목마다 `takes` 가 여럿입니다.
 */

export type DepositRow = { id: string; amount: number; paidAt: string };
export type LineNeed = { id: string; amount: number; /** 함께 덮이는 줄(할인 줄). */ members?: string[] };

/**
 * **청구서 줄을 「항목」으로 묶습니다.**
 *
 * 학비 청구서는 할인을 **따로 줄로** 적습니다(「정규과정 4,000,000」 아래 「└ 형제할인
 * −400,000」). 예치금에서 「정규과정」을 뺀다는 것은 할인까지 뺀 3,600,000원을 뺀다는 뜻입니다.
 * 줄 하나씩 고르게 두면 4,000,000원이 빠지고 할인 줄만 미납으로 남습니다.
 *
 * 그래서 음수 줄은 **바로 위 양수 줄**에 붙입니다. 위에 붙을 줄이 없는 음수 줄(이월 차감 등)은
 * 항목으로 내놓지 않습니다 - 예치금으로 «빼기»를 덮을 수는 없으니까요.
 */
export type LineItem = { id: string; name: string; amount: number; members: string[]; paid: boolean };
export function groupLines(
  lines: { id: string; name: string; amount: number; paid_payment_id?: string | null }[],
): LineItem[] {
  const out: LineItem[] = [];
  for (const l of lines) {
    const a = Math.round(Number(l.amount));
    if (a < 0) {
      const head = out[out.length - 1];
      if (head) {
        head.amount += a;
        head.members.push(l.id);
        head.paid = head.paid && !!l.paid_payment_id;
      }
      continue;
    }
    out.push({ id: l.id, name: l.name, amount: a, members: [l.id], paid: !!l.paid_payment_id });
  }
  return out.filter((i) => i.amount > 0);
}

/** 예치금 한 줄에서 얼마를 떼어 한 항목에 붙이는가. */
export type DepositTake = { depositId: string; amount: number };
export type LinePlan = { lineId: string; need: number; covered: number; takes: DepositTake[] };

export type DeductionPlan = {
  lines: LinePlan[];
  /** 이번에 빠지는 총액. */
  applied: number;
  /** 다 못 덮은 항목(있으면 하나, 언제나 마지막). */
  partial: { lineId: string; covered: number; need: number } | null;
  /** 뺀 뒤 남는 예치금. */
  left: number;
};

/**
 * 쓸 수 있는 예치금. 음수 줄(예치금에서 돌려드린 환불)이 있으면 그만큼 줄어듭니다 -
 * 양수 줄만 더하면 이미 돌려드린 돈을 한 번 더 씁니다.
 */
export function depositBalance(rows: { amount: number }[]): number {
  return Math.max(0, rows.reduce((n, r) => n + r.amount, 0));
}

export function planDeduction(rows: DepositRow[], lines: LineNeed[], cap?: number): DeductionPlan {
  const pool = rows
    .filter((r) => r.amount > 0)
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, left: r.amount }));
  // 환불로 줄어든 만큼은 못 씁니다. 한도를 따로 두고, 줄은 먼저 들어온 것부터 씁니다.
  const total = Math.min(cap ?? Infinity, pool.reduce((n, p) => n + p.left, 0));
  let budget = total;
  const plan: DeductionPlan = { lines: [], applied: 0, partial: null, left: 0 };

  for (const line of lines) {
    const need = Math.max(0, Math.round(line.amount));
    if (need <= 0 || budget <= 0) break;
    const lp: LinePlan = { lineId: line.id, need, covered: 0, takes: [] };
    let want = Math.min(need, budget);
    for (const p of pool) {
      if (want <= 0) break;
      if (p.left <= 0) continue;
      const take = Math.min(p.left, want);
      lp.takes.push({ depositId: p.id, amount: take });
      p.left -= take;
      want -= take;
      lp.covered += take;
    }
    if (lp.covered <= 0) break;
    budget -= lp.covered;
    plan.applied += lp.covered;
    plan.lines.push(lp);
    if (lp.covered < need) {
      plan.partial = { lineId: line.id, covered: lp.covered, need };
      break;
    }
  }
  plan.left = Math.max(0, total - plan.applied);
  return plan;
}

/**
 * **사람이 안 고를 때(일괄 발행)** 덮을 항목. 순서대로 보면서 **통째로 들어가는 항목만**
 * 고릅니다. 들어가지 않는 항목은 건너뛰고 다음 것을 봅니다.
 *
 * 일부만 덮지 않는 이유: 사람이 안 본 자리에서 「교복 중 일부」를 만들면, 학부모에게 가는
 * 종이에 아무도 정하지 않은 쪼개진 금액이 찍힙니다. 남는 예치금은 그대로 남아 있고, 금전
 * 창에서 언제든 골라 뺄 수 있습니다.
 */
export function firstFitLines(available: number, lines: LineNeed[]): string[] {
  const out: string[] = [];
  let left = available;
  for (const l of lines) {
    const a = Math.round(l.amount);
    if (a > 0 && a <= left) {
      out.push(l.id);
      left -= a;
    }
  }
  return out;
}

/**
 * 이 입금이 **예치금에서 옮겨 붙은 돈**인가.
 *
 * 붙이는 자리가 셋이라 표시가 셋입니다 - 발행 때 저절로(`선입금 자동충당`), 예치금 대장에서
 * 손으로(`선입금 수동충당(…)`), 항목을 골라서(`예치금 차감`). 셋 다 같은 뜻이므로 한 곳에서
 * 가립니다. 취소·되돌리기·인쇄가 각자 가리면 하나를 빠뜨린 화면만 다른 답을 합니다.
 */
export const DEPOSIT_PICKED = "예치금 차감";
export function isFromDeposit(matchedBy: string | null | undefined): boolean {
  const m = matchedBy ?? "";
  return m === "선입금 자동충당" || m.startsWith("선입금 수동충당") || m.startsWith(DEPOSIT_PICKED);
}
