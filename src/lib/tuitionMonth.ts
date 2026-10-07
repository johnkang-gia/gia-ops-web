/**
 * **이 학비 항목이 그 달에 청구됐는가** — 학비 표와 학생 금전 창이 같이 씁니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────────────
 *
 * 학비는 학기 단위로만 「청구됨」을 판정했습니다. 월납 방과후를 9월에 한 번 청구하면 그 학기
 * 내내 「청구 완료」로 남아 10월분을 낼 자리가 없었고, 화면에는 지난달 청구서가 계속 떠
 * 있었습니다.
 *
 * ── 세 갈래 ────────────────────────────────────────────────────────────────
 *
 *   학기  기준금액이 학기·연·회 단위인 항목(정규과정, 연 1회 LMA). 학기에 한 장이면 끝.
 *   월    월 단위 항목을 한 달씩 내는 경우(월 납부). 그 달 청구서가 있어야 청구됨.
 *   기간  월 단위 항목을 여러 달 묶어 낸 경우(5개월·10개월 납부). 시작월부터 회차만큼이
 *         납부 기간이고, 그 안의 달은 전부 청구됨입니다.
 *
 * 기간의 시작월은 **사람이 적은 값**(`student_fee_enrollments.paid_from`)이 먼저입니다. 운영앱
 * 이전에 받은 돈은 청구서가 없으므로 사람이 적어야만 압니다. 적은 값이 없으면 그 항목이 담긴
 * 청구서의 청구월에서 셉니다.
 *
 * 판정은 여기 한 곳에서만 합니다(CLAUDE.md §2-11과 같은 이유) - 두 화면이 각자 세면 한쪽은
 * 「청구됨」, 한쪽은 「남음」이 되고 그 아이는 두 번 청구됩니다.
 */

import { billingMonthOf, shiftMonth, type MonthKey } from "@/lib/financePeriod";

export type BillRule = "학기" | "월" | "기간";

export type MonthSpan = { from: MonthKey; to: MonthKey };

/** 학비 청구서 중 판정에 필요한 칸만. 살아 있는(발행 · 이월 안 됨) 장만 넘겨주세요. */
export type MonthInvoice = {
  id: string;
  invoice_no?: string | null;
  billing_month?: string | null;
  issue_date: string;
  plan_scope?: string | null;
};

export type MonthBill = {
  rule: BillRule;
  /** 여러 달 묶음일 때 몇 달인가. 나머지는 0. */
  months: number;
  /** 그 달을 덮는 청구서. 기간 납부를 사람이 적기만 했으면 없습니다. */
  invoice: MonthInvoice | null;
  /** 그 달에 더 청구할 것이 없는가. */
  covered: boolean;
  /** 그 달을 덮는 납부 기간(기간 갈래만). */
  span: MonthSpan | null;
  /** 기간을 어디서 알았나 - 사람이 적은 시작월인가, 청구서에서 셌나. */
  spanSource: "입력" | "청구서" | null;
};

export function billRuleOf(
  plan: { unit?: string | null },
  option: { periods?: number | string | null } | null,
): { rule: BillRule; months: number } {
  if ((plan.unit ?? "월") !== "월" || !option) return { rule: "학기", months: 0 };
  const n = Math.max(1, Math.round(Number(option.periods ?? 1)) || 1);
  return n <= 1 ? { rule: "월", months: 1 } : { rule: "기간", months: n };
}

/** 범위가 빈 학비 청구서는 학비 **전부**를 담은 것입니다(항목별 발행 전부터 그랬습니다). */
export function invoiceCoversPlan(v: { plan_scope?: string | null }, planName: string): boolean {
  const scope = v.plan_scope ?? null;
  if (!scope) return true;
  return scope.split(" · ").some((n) => n.trim() === planName);
}

export function spanOf(from: MonthKey, months: number): MonthSpan {
  return { from, to: shiftMonth(from, Math.max(1, months) - 1) };
}

export function inSpan(month: MonthKey | null, span: MonthSpan): boolean {
  return !!month && month >= span.from && month <= span.to;
}

/** 「2026-09 ~ 2027-01」 */
export function spanLabel(span: MonthSpan): string {
  return `${span.from} ~ ${span.to}`;
}

/**
 * 이 학생의 이 항목이 `month` 에 청구됐는가.
 *
 * @param invoices 이 학생의 같은 학기 학비 청구서(살아 있는 장). 이 함수가 항목으로 거릅니다.
 */
export function planBillForMonth(args: {
  plan: { name: string; unit?: string | null };
  option: { periods?: number | string | null } | null;
  paidFrom: string | null;
  invoices: readonly MonthInvoice[];
  month: MonthKey;
}): MonthBill {
  const { plan, option, month } = args;
  const { rule, months } = billRuleOf(plan, option);
  const covering = args.invoices
    .filter((v) => invoiceCoversPlan(v, plan.name))
    .sort((a, b) => (billingMonthOf(a) ?? "").localeCompare(billingMonthOf(b) ?? ""));

  if (rule === "학기") {
    const inv = covering[0] ?? null;
    return { rule, months, invoice: inv, covered: !!inv, span: null, spanSource: null };
  }

  if (rule === "월") {
    const inv = covering.find((v) => billingMonthOf(v) === month) ?? null;
    return { rule, months, invoice: inv, covered: !!inv, span: null, spanSource: null };
  }

  // 기간 — 사람이 적은 시작월이 있으면 그 기간이 먼저이고, 그 뒤에 새로 낸 기간(다음 묶음)은
  // 청구서에서 셉니다. 적은 값이 없으면 청구서마다 그 청구월부터 회차만큼입니다.
  const spans: { span: MonthSpan; inv: MonthInvoice | null; source: "입력" | "청구서" }[] = [];
  const typed = /^\d{4}-(0[1-9]|1[0-2])$/.test(args.paidFrom ?? "") ? (args.paidFrom as MonthKey) : null;
  if (typed) {
    const s = spanOf(typed, months);
    spans.push({ span: s, inv: covering.find((v) => inSpan(billingMonthOf(v), s)) ?? null, source: "입력" });
    for (const v of covering) {
      const b = billingMonthOf(v);
      if (b && b > s.to) spans.push({ span: spanOf(b, months), inv: v, source: "청구서" });
    }
  } else {
    for (const v of covering) {
      const b = billingMonthOf(v);
      if (b) spans.push({ span: spanOf(b, months), inv: v, source: "청구서" });
    }
  }
  const hit = spans.find((x) => inSpan(month, x.span)) ?? null;
  if (hit) return { rule, months, invoice: hit.inv, covered: true, span: hit.span, spanSource: hit.source };
  // 그 달에 따로 낸 장이 있으면 그것도 청구됨입니다(묶음을 끊고 한 달만 낸 경우).
  const own = covering.find((v) => billingMonthOf(v) === month) ?? null;
  return { rule, months, invoice: own, covered: !!own, span: null, spanSource: null };
}
