/**
 * **학생 원장** — 학생 한 명의 받을 돈 · 청구서 · 입금 · 예치금을 한 자리에서 셉니다.
 *
 * ── 왜 한 곳인가 ────────────────────────────────────────────────────────────
 *
 * 「이 아이에게 얼마를 청구해야 하나」를 학비 표·학비외 표·수납·미납·학생 검색이 저마다
 * 계산했습니다. 같은 자료를 다른 순서로 더해 다른 답이 났고, 돈 이야기에서 두 화면이 다른
 * 숫자를 말하면 아무도 안 믿습니다.
 *
 * 여기서는 **이미 한 곳에 있는 규칙만 부릅니다** — 학비 한 줄은 `tuitionLine`, 학비외 항목은
 * `resolveStudentItems`, 이미 청구됐는가는 `billedItems`(학비외) · `plan_scope`(학비), 청구서
 * 상태는 `settle`. 규칙을 새로 만들지 않습니다. 모아서 한 번에 세는 것이 이 파일의 전부입니다.
 *
 * 순수 함수입니다 — 자료를 넘겨주면 답을 냅니다. 화면 없이 시험할 수 있습니다.
 */

import type { FeeDiscount, FeeItem, FeePaymentOption, FeePlan, Invoice, StudentFeeItem } from "@/lib/types";
import { tuitionLine, discountsForPlan, planTargets, type TuitionLine } from "@/lib/tuition";
import { resolveStudentItems, inTerm, type ResolvedLine } from "@/lib/feeItems";
import { billedItems, markOf, type BilledLine, type BillState } from "@/lib/billedItems";
import { settle, streamOf, type Settled } from "@/lib/settlement";

export type LedgerStudent = {
  id: string;
  name: string;
  name_en?: string | null;
  grade: string | null;
  class_name: string | null;
  department?: string | null;
};

export type Enrollment = {
  student_id: string;
  plan_id: string;
  option_id: string | null;
  term_id: string | null;
  active?: boolean;
  override_amount: number | null;
  override_note: string | null;
};

export type StudentDiscountRow = { student_id: string; discount_id: string; term_id: string | null; plan_id: string | null };

export type LedgerPayment = {
  id: string;
  invoice_id: string | null;
  student_id: string | null;
  paid_at: string;
  amount: number | string;
  method: string | null;
  memo: string | null;
  origin?: string | null;
  kind?: string | null;
};

/** 원장이 받는 자료 전부. 화면이 한 번 읽어 넘기고, 학생마다 `buildLedger` 를 부릅니다. */
export type LedgerWorld = {
  termId: string | null;
  termIsCurrent: boolean;
  today: string;
  plans: FeePlan[];
  options: FeePaymentOption[];
  discounts: FeeDiscount[];
  enrollments: Enrollment[];
  studentDiscounts: StudentDiscountRow[];
  items: FeeItem[];
  overrides: StudentFeeItem[];
  invoices: Invoice[];
  lines: BilledLine[];
  payments: LedgerPayment[];
};

/** 받을 돈 한 줄. 학비든 학비외든 같은 모양입니다 - 화면이 둘을 따로 그릴 이유가 없습니다. */
export type LedgerCharge = {
  kind: "학비" | "학비외";
  /** 학비는 항목(plan) 번호, 학비외는 항목(item) 번호. 발행할 때 그대로 보냅니다. */
  id: string;
  label: string;
  /** 학비외의 분류(교재·교복…). 학비는 "학비". */
  category: string;
  amount: number;
  /** 학비: 고른 옵션 이름. 없으면 「신청 안 함」. */
  optionName: string | null;
  /** 할인·직접 정한 금액 등 비고. */
  note: string | null;
  /** 이미 청구서에 담겼으면 그 장. 없으면 아직 안 보낸 것(「남음」). */
  billed: { state: BillState; invoiceId: string; invoiceNo: string | null; unsure: boolean } | null;
  /** 학비 전용: 옵션 고르기용. */
  tuition?: { planId: string; optionId: string | null; options: { id: string; name: string }[]; discounts: { id: string; name: string; on: boolean }[] };
  /** 학비외 전용: 기본 세트인가, 사람이 따로 넣었나, 수량. */
  extra?: { itemId: string; qty: number; fromDefault: boolean };
};

export type LedgerInvoice = Invoice & { settled: Settled; stream: "학비" | "학비외"; exported: boolean };

export type Ledger = {
  student: LedgerStudent;
  charges: LedgerCharge[];
  invoices: LedgerInvoice[];
  payments: LedgerPayment[];
  totals: {
    /** 아직 어느 청구서에도 안 담긴 받을 돈. 「청구할 금액」. */
    toBill: number;
    /** 살아 있는 청구서의 합. */
    billed: number;
    /** 그중 아직 안 들어온 돈. */
    unpaid: number;
    /** 어느 청구서에도 안 붙은 입금 = 예치금. */
    deposit: number;
    /** 올해(이 학기) 받을 돈 전체 = 청구할 금액 + 청구된 금액. */
    expected: number;
  };
};

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 학비 쪽 「이미 담겼나」. 학비 청구서는 `plan_scope` 에 항목 이름을 적습니다(항목 번호가
 * 없던 때부터 그랬습니다). 범위가 빈 장은 학비 전부를 담은 것입니다. 학비 표와 같은 규칙입니다.
 */
function tuitionBilledOf(
  invoices: Invoice[],
  payments: LedgerPayment[],
  studentId: string,
  termId: string | null,
  termIsCurrent: boolean,
): { all: Invoice | null; byName: Map<string, Invoice> } {
  const paidBy = new Map<string, number>();
  for (const p of payments) if (p.invoice_id) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + num(p.amount));
  let all: Invoice | null = null;
  const byName = new Map<string, Invoice>();
  for (const v of invoices) {
    if (v.student_id !== studentId || v.status !== "발행") continue;
    if (streamOf(v) !== "학비") continue;
    if ((v as { carried_to_invoice_id?: string | null }).carried_to_invoice_id) continue;
    const sameT = (v.term_id ?? "") === (termId ?? "") || (!v.term_id && termIsCurrent);
    if (!sameT) continue;
    const scope = (v as { plan_scope?: string | null }).plan_scope ?? null;
    if (!scope) {
      all = all ?? v;
      continue;
    }
    for (const n of scope.split(" · ")) {
      const key = n.trim();
      // 같은 항목이 여러 장이면 덜 걷힌 쪽이 사실입니다(학비 표와 같음).
      const cur = byName.get(key);
      if (!cur) byName.set(key, v);
      else {
        const curPaid = paidBy.get(cur.id) ?? 0;
        const vPaid = paidBy.get(v.id) ?? 0;
        if (vPaid < curPaid) byName.set(key, v);
      }
    }
  }
  return { all, byName };
}

function stateOf(inv: Invoice, payments: LedgerPayment[]): BillState {
  const paid = payments.filter((p) => p.invoice_id === inv.id).reduce((n, p) => n + num(p.amount), 0);
  const total = num(inv.total_amount);
  return paid <= 0 ? "미납" : paid >= total ? "완납" : "일부";
}

/** 이 항목에 붙은 할인 번호. 옵션을 안 고른 항목(line 없음)에도 붙은 할인은 보여야 합니다. */
function forPlanIds(sd: StudentDiscountRow[], discounts: FeeDiscount[], planId: string, termId: string | null): string[] {
  return discountsForPlan(sd, discounts, planId, termId).map((d) => d.id);
}

export function buildLedger(world: LedgerWorld, student: LedgerStudent): Ledger {
  const { termId, termIsCurrent, today } = world;
  const myPayments = world.payments.filter((p) => p.student_id === student.id);
  const myInvoices = world.invoices.filter((v) => v.student_id === student.id);

  // ── 학비 ───────────────────────────────────────────────────────────────
  const sameTerm = <T extends { term_id?: string | null }>(r: T) => !r.term_id || !termId || r.term_id === termId;
  const myEnroll = world.enrollments.filter((e) => e.student_id === student.id && e.active !== false).filter(sameTerm);
  const mySd = world.studentDiscounts.filter((d) => d.student_id === student.id);
  const tb = tuitionBilledOf(myInvoices, myPayments, student.id, termId, termIsCurrent);

  const charges: LedgerCharge[] = [];
  for (const plan of world.plans) {
    if (plan.category !== "학비" || !plan.active) continue;
    // 대상이 아닌 항목은 줄을 만들지 않습니다. 열려 있으면 실수로 고르고, 그건 오류가 아니라
    // 「청구된 금액」으로 보입니다.
    if (!planTargets(plan, { grade: student.grade, className: student.class_name, department: student.department ?? null })) continue;
    const e = myEnroll.find((x) => x.plan_id === plan.id) ?? null;
    const option = world.options.find((o) => o.id === e?.option_id) ?? null;
    const line: TuitionLine | null = e
      ? tuitionLine(plan, option, discountsForPlan(mySd, world.discounts, plan.id, termId), {
          amount: e.override_amount === null || e.override_amount === undefined ? null : Number(e.override_amount),
          note: e.override_note,
        })
      : null;
    const billedInv = tb.all ?? tb.byName.get(plan.name) ?? null;
    const bits: string[] = [];
    if (line) {
      if (line.optionDiscount > 0) bits.push(`${line.optionName} −${Math.round(line.optionDiscount).toLocaleString()}`);
      for (const d of line.discounts) bits.push(`${d.name} −${Math.round(d.amount).toLocaleString()}`);
      if (line.manual) bits.push(`직접 정한 금액${line.note ? ` · ${line.note}` : ""}`);
    }
    charges.push({
      kind: "학비",
      id: plan.id,
      label: plan.name,
      category: "학비",
      amount: line?.amount ?? 0,
      optionName: line?.optionName ?? null,
      note: bits.length ? bits.join(" · ") : null,
      billed: billedInv
        ? { state: stateOf(billedInv, myPayments), invoiceId: billedInv.id, invoiceNo: billedInv.invoice_no, unsure: false }
        : null,
      tuition: {
        planId: plan.id,
        optionId: e?.option_id ?? null,
        options: world.options.filter((o) => o.plan_id === plan.id && o.active).map((o) => ({ id: o.id, name: o.name })),
        // 이 항목에 걸 수 있는 할인 전부와 지금 붙어 있는지. 학비 일괄 표와 같은 재료라 같은 금액이 나옵니다.
        discounts: world.discounts
          .filter((d) => d.active && (d.category === "학비" || d.category === null) && (!d.plan_id || d.plan_id === plan.id))
          .map((d) => ({ id: d.id, name: d.name, on: forPlanIds(mySd, world.discounts, plan.id, termId).includes(d.id) })),
      },
    });
  }

  // ── 학비외 ─────────────────────────────────────────────────────────────
  const items = world.items.filter((i) => inTerm(i, termId ?? "", termIsCurrent));
  const resolved: ResolvedLine[] = resolveStudentItems(
    items,
    { id: student.id, grade: student.grade, className: student.class_name, department: student.department ?? null },
    world.overrides,
  );
  const marks = billedItems(
    myInvoices as unknown as Parameters<typeof billedItems>[0],
    world.lines.filter((l) => myInvoices.some((v) => v.id === l.invoice_id)),
    myPayments,
  ).get(student.id);
  const sameName = new Map<string, number>();
  for (const i of items) sameName.set(i.name, (sameName.get(i.name) ?? 0) + 1);
  for (const r of resolved) {
    const m = markOf(marks, r.item, sameName.get(r.item.name) ?? 1);
    const inv = m ? myInvoices.find((v) => v.id === m.invoiceId) ?? null : null;
    charges.push({
      kind: "학비외",
      id: r.item.id,
      label: r.item.name_ko ? `${r.item.name_ko} (${r.item.name})` : r.item.name,
      category: r.item.category,
      amount: r.amount,
      optionName: r.qty > 1 ? `${r.qty}개` : null,
      note: r.fromDefault ? null : "개별 추가",
      billed: m ? { state: m.state, invoiceId: m.invoiceId, invoiceNo: inv?.invoice_no ?? null, unsure: m.unsure } : null,
      extra: { itemId: r.item.id, qty: r.qty, fromDefault: r.fromDefault },
    });
  }

  // ── 청구서 ─────────────────────────────────────────────────────────────
  const invoices: LedgerInvoice[] = myInvoices
    .map((v) => ({
      ...v,
      settled: settle(v as unknown as Parameters<typeof settle>[0], myPayments, today),
      stream: streamOf(v),
      exported: !!v.exported_at,
    }))
    .sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : a.invoice_no < b.invoice_no ? 1 : -1));

  // ── 합계 ───────────────────────────────────────────────────────────────
  // 청구할 금액은 **옵션을 고른(금액이 있는) 항목 중 아직 안 담긴 것**만 셉니다. 옵션을 안
  // 고른 학비 항목은 0원이라 저절로 빠집니다.
  const toBill = charges.filter((c) => !c.billed && c.amount > 0).reduce((n, c) => n + c.amount, 0);
  const alive = invoices.filter((v) => v.settled.state !== "취소" && v.settled.state !== "이월됨");
  const billed = alive.reduce((n, v) => n + num(v.total_amount), 0);
  const unpaid = alive.reduce((n, v) => n + Math.max(0, v.settled.balance), 0);
  const deposit = myPayments.filter((p) => !p.invoice_id && (p.kind ?? "") !== "refund").reduce((n, p) => n + num(p.amount), 0);

  return {
    student,
    charges,
    invoices,
    payments: [...myPayments].sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1)),
    totals: { toBill, billed, unpaid, deposit, expected: toBill + billed },
  };
}
