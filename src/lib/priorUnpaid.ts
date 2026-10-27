import { settle, isOutstanding, streamOf, type SettleInvoice, type SettlePayment, type InvoiceStream } from "./settlement";
import { billingMonthOf } from "./financePeriod";

/**
 * **지난 달까지의 미납** — 청구 화면이 발행 자리에서 바로 보는 것.
 *
 * 수납 처리가 안 된 청구서는 아무 일을 하지 않아도 다음 달로 밀립니다. 따로 «미납 도장»을
 * 찍지 않습니다 - 잔액(청구액 − 입금 − 결손)이 남아 있고, 취소·이월되지 않았으면 그것이 곧
 * 미납입니다. 상태를 칸에 적어 두면 입금이 들어왔을 때 그 칸을 고치는 것을 잊는 날이 옵니다
 * (CLAUDE.md §2-12).
 *
 * 보고 있는 달(`month`)보다 **앞선 달**의 장만 셉니다. 이 달 장은 이 달 표의 「미수금」 칸이
 * 이미 보여 주고 있습니다 - 같은 돈을 두 칸에 적으면 두 배로 읽힙니다.
 */
export type PriorUnpaidRow = {
  invoice: SettleInvoice;
  balance: number;
  overdueDays: number;
  stream: InvoiceStream;
  billingMonth: string;
};

export function priorUnpaidOf(
  invoices: readonly SettleInvoice[],
  payments: readonly SettlePayment[],
  opts: { studentId: string; month: string; today: string },
): PriorUnpaidRow[] {
  const out: PriorUnpaidRow[] = [];
  for (const v of invoices) {
    if (v.student_id !== opts.studentId) continue;
    const bm = billingMonthOf(v);
    if (!bm || bm >= opts.month) continue;
    const s = settle(v, payments as SettlePayment[], opts.today);
    if (!isOutstanding(s)) continue;
    out.push({ invoice: v, balance: s.balance, overdueDays: s.overdueDays, stream: streamOf(v), billingMonth: bm });
  }
  return out.sort((a, b) => a.invoice.issue_date.localeCompare(b.invoice.issue_date));
}

/** 이번 달 학비 장에 얹힐 금액 — 서버(`planCarryForward`)와 같은 기준: 학비 갈래만. */
export function tuitionCarryTotal(rows: readonly PriorUnpaidRow[]): number {
  return rows.filter((r) => r.stream === "학비").reduce((n, r) => n + r.balance, 0);
}

/** 합치면 커지는 장에 대한 경고. 실측: 200만 초과 장은 수납 0%, 30만 이하가 57.8%. */
export function carryWarning(carry: number, thisMonth: number): string | null {
  const total = carry + thisMonth;
  if (total > 2_000_000) return `합치면 ${Math.round(total).toLocaleString("ko-KR")}원 한 장이 됩니다. 8~9월에 200만원을 넘긴 장은 한 건도 안 걷혔습니다 — 따로 보내는 편이 낫습니다.`;
  if (total > 1_000_000) return `합치면 ${Math.round(total).toLocaleString("ko-KR")}원 한 장이 됩니다. 100만원을 넘으면 수납률이 크게 떨어집니다.`;
  return null;
}
