import { needsCashReceipt, type PaymentRow } from "./payments";
import type { Invoice } from "./types";

/**
 * 학생 한 명의 «이 학기에 얼마를 어떻게 냈는가».
 *
 * 지금까지 돈 이야기는 두 화면에 흩어져 있었습니다 — 인보이스 명단은 «누구에게 얼마를
 * 청구했나», 수납 화면은 «어떤 돈이 들어왔나». 그런데 상담 자리에서 필요한 것은
 * **한 아이의 한 학기**입니다. 「고서윤 학생이 이번 학기 학비를 뭘로 얼마 냈나요」에
 * 답하려면 두 화면을 오가며 사람이 머릿속에서 이어붙여야 했습니다.
 *
 * 계산은 저장하지 않고 그때그때 냅니다. 저장해두면 인보이스를 취소하거나 입금을 다시
 * 붙였을 때 어긋나고, 어긋난 줄은 아무도 모릅니다.
 */

export type TermFeeSummary = {
  termId: string | null;
  /** 화면에 쓸 학기 이름. 못 찾으면 발행 연도로 대신합니다. */
  termLabel: string;
  invoices: Invoice[];
  payments: PaymentRow[];
  billed: number;
  paid: number;
  balance: number;
  /** 이 학기에 쓰인 납부 수단들. 여러 갈래로 나눠 내는 학생이 실제로 있습니다. */
  methods: { kind: string; amount: number; count: number }[];
  /** 현금·계좌이체인데 현금영수증이 아직 없는 금액. 0이면 걸린 것이 없습니다. */
  receiptPending: number;
  /** 마감일이 지났는데 아직 남은 돈. */
  overdue: number;
};

const num = (v: unknown) => Number(v ?? 0) || 0;

/** 옛 줄은 method_kind 가 비어 있습니다. 그때는 자유 글자에서 읽어냅니다. */
export function methodKindOf(p: PaymentRow): string {
  const k = (p.method_kind ?? "").trim();
  if (k) return k;
  const m = (p.method ?? "").trim();
  if (m.includes("올톡")) return "올톡페이";
  if (m.includes("카드")) return "방문카드";
  if (m.includes("이체") || m.includes("계좌")) return "계좌이체";
  if (m.includes("현금")) return "현금";
  return "기타";
}

export function summarizeByTerm(
  invoices: Invoice[],
  payments: PaymentRow[],
  termLabels: Record<string, string>,
  /** 현금영수증이 이미 있는 payment id. 없으면 «발행 안 함»으로 봅니다. */
  receiptedPaymentIds: Set<string>,
  today: string,
): TermFeeSummary[] {
  // 취소된 청구서는 «청구한 적 없는 것»입니다. 합계에 넣으면 미수금이 부풀어, 실제로는
  // 다 낸 학생이 밀린 학생처럼 보입니다.
  const live = invoices.filter((v) => v.status !== "취소");

  const byTerm = new Map<string, { inv: Invoice[]; pay: PaymentRow[] }>();
  const keyOf = (t: string | null | undefined) => t ?? "";

  for (const v of live) {
    const k = keyOf(v.term_id);
    (byTerm.get(k) ?? byTerm.set(k, { inv: [], pay: [] }).get(k)!).inv.push(v);
  }
  // 입금은 인보이스를 통해 학기에 붙습니다. 아직 어느 청구서인지 못 붙인 돈은 학기를
  // 알 수 없으므로 «미분류»로 따로 둡니다 - 아무 학기에나 넣으면 그 학기 숫자가 틀립니다.
  const termOfInvoice = new Map(live.map((v) => [v.id, keyOf(v.term_id)]));
  for (const p of payments) {
    const k = p.invoice_id ? termOfInvoice.get(p.invoice_id) : undefined;
    if (k === undefined) continue;
    (byTerm.get(k) ?? byTerm.set(k, { inv: [], pay: [] }).get(k)!).pay.push(p);
  }

  const out: TermFeeSummary[] = [];
  for (const [k, g] of byTerm) {
    const billed = g.inv.reduce((n, v) => n + num(v.total_amount), 0);
    const paid = g.pay.reduce((n, p) => n + num(p.amount), 0);

    const mm = new Map<string, { amount: number; count: number }>();
    for (const p of g.pay) {
      const kind = methodKindOf(p);
      const cur = mm.get(kind) ?? { amount: 0, count: 0 };
      cur.amount += num(p.amount);
      cur.count += 1;
      mm.set(kind, cur);
    }

    const receiptPending = g.pay
      .filter((p) => needsCashReceipt(methodKindOf(p)) && !receiptedPaymentIds.has(p.id))
      .reduce((n, p) => n + num(p.amount), 0);

    // 마감이 지난 청구서만 봅니다. 아직 안 지난 것은 «안 낸 것»이 아니라 «낼 때가 안 된 것»입니다.
    const overdueBilled = g.inv.filter((v) => v.due_date && v.due_date < today).reduce((n, v) => n + num(v.total_amount), 0);
    const overduePaid = g.pay
      .filter((p) => {
        const v = g.inv.find((x) => x.id === p.invoice_id);
        return !!v?.due_date && v.due_date < today;
      })
      .reduce((n, p) => n + num(p.amount), 0);

    out.push({
      termId: k || null,
      termLabel: k ? (termLabels[k] ?? "학기 미상") : "학기 없음",
      invoices: g.inv,
      payments: g.pay,
      billed,
      paid,
      balance: Math.round(billed - paid),
      methods: [...mm.entries()]
        .map(([kind, v]) => ({ kind, ...v }))
        .sort((a, b) => b.amount - a.amount),
      receiptPending,
      overdue: Math.max(0, Math.round(overdueBilled - overduePaid)),
    });
  }

  // 최근 학기부터. 학기 id 가 없으면 뒤로 보냅니다.
  return out.sort((a, b) => {
    const ai = a.invoices[0]?.issue_date ?? "";
    const bi = b.invoices[0]?.issue_date ?? "";
    return bi.localeCompare(ai);
  });
}

/**
 * 상습 미납 판정.
 *
 * «지금 얼마 밀렸나»와 «자주 밀리나»는 다른 물음입니다. 이번 달에 크게 밀린 학생은 사정이
 * 있었을 수 있지만, 매번 조금씩 늦는 학생은 안내 방식을 바꿔야 합니다. 앞엣것만 보면
 * 뒤엣것이 안 보입니다.
 *
 * 세는 것은 **마감이 지난 뒤에도 잔액이 남았던 청구서 수**입니다. 지금 다 냈더라도
 * 늦게 낸 사실은 남습니다.
 */
export type LatePayerStat = {
  studentId: string;
  studentName: string;
  /** 마감을 넘긴 청구서 수. */
  lateCount: number;
  /** 마감이 지난 청구서 수 대비. */
  totalDue: number;
  /** 지금 남은 미수금. */
  outstanding: number;
  /** 평균 며칠 늦게 냈는가(다 낸 건만). null이면 아직 안 낸 것뿐입니다. */
  avgDaysLate: number | null;
};

export function latePayers(
  invoices: Invoice[],
  payments: PaymentRow[],
  today: string,
): LatePayerStat[] {
  const live = invoices.filter((v) => v.status !== "취소" && v.student_id);
  const payByInvoice = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    (payByInvoice.get(p.invoice_id) ?? payByInvoice.set(p.invoice_id, []).get(p.invoice_id)!).push(p);
  }

  const byStudent = new Map<string, LatePayerStat & { _lateDays: number[] }>();
  for (const v of live) {
    const sid = v.student_id as string;
    const cur =
      byStudent.get(sid) ??
      byStudent
        .set(sid, {
          studentId: sid,
          studentName: v.student_name_ko || v.student_name,
          lateCount: 0,
          totalDue: 0,
          outstanding: 0,
          avgDaysLate: null,
          _lateDays: [],
        })
        .get(sid)!;

    const ps = payByInvoice.get(v.id) ?? [];
    const paid = ps.reduce((n, p) => n + num(p.amount), 0);
    const bal = Math.round(num(v.total_amount) - paid);
    cur.outstanding += Math.max(0, bal);

    if (!v.due_date || v.due_date >= today) continue; // 아직 마감 전 - 늦은 것이 아닙니다
    cur.totalDue += 1;

    if (bal > 0) {
      cur.lateCount += 1; // 마감이 지났는데 아직 남았습니다
      continue;
    }
    // 다 냈지만 마감 뒤에 낸 것인가. 마지막 입금일로 봅니다.
    const last = ps.map((p) => p.paid_at).sort().pop();
    if (last && last > v.due_date) {
      cur.lateCount += 1;
      const days = Math.round((new Date(last).getTime() - new Date(v.due_date).getTime()) / 86400000);
      if (days > 0) cur._lateDays.push(days);
    }
  }

  return [...byStudent.values()]
    .map(({ _lateDays, ...s }) => ({
      ...s,
      avgDaysLate: _lateDays.length > 0 ? Math.round(_lateDays.reduce((a, b) => a + b, 0) / _lateDays.length) : null,
    }))
    .filter((s) => s.lateCount > 0)
    // 자주 밀린 순 → 많이 남은 순. 한 번 크게 밀린 학생보다 매번 밀리는 학생이 먼저입니다.
    .sort((a, b) => b.lateCount - a.lateCount || b.outstanding - a.outstanding);
}
