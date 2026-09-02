import type { Invoice } from "@/lib/types";

// 수납 대사 — 들어온 돈을 인보이스에 붙이는 규칙 한 곳.
//
// 통장에는 아이 이름이 아니라 **보호자 이름**이 찍히는 경우가 많고, 금액도 두 아이를 한 번에
// 내면 합쳐져 옵니다. 그래서 자동으로 붙일 수 있는 것만 붙이고, 애매한 것은 **애매하다고
// 말합니다.** 어림짐작으로 붙이면 틀린 곳을 아무도 못 찾습니다.

export type PaymentRow = {
  id: string;
  invoice_id: string | null;
  student_id: string | null;
  paid_at: string;
  amount: number;
  method: string | null;
  payer_name: string | null;
  memo: string | null;
  source: string;
  source_key: string | null;
  matched_by: string | null;
  created_by: string | null;
  created_at: string;
};

/** 엑셀에서 읽어낸 한 줄(아직 저장 전). */
export type ImportedPayment = {
  rowNo: number;
  paidAt: string;
  amount: number;
  payerName: string;
  memo: string;
  sourceKey: string;
};

const norm = (s: string | null | undefined) => (s ?? "").toString().toLowerCase().replace(/\s+/g, "");

/** 인보이스별 입금 합과 잔액. **저장하지 않고 그때그때 냅니다** - 두 곳에 두면 어긋납니다. */
export function balanceOf(invoice: Invoice, payments: PaymentRow[]): { paid: number; balance: number } {
  const paid = payments.filter((p) => p.invoice_id === invoice.id).reduce((n, p) => n + Number(p.amount), 0);
  return { paid, balance: Math.round(Number(invoice.total_amount) - paid) };
}

export type MatchCandidate = { invoice: Invoice; why: string };

/**
 * 이 입금이 어느 인보이스 것인지 고릅니다.
 *
 * 판단 순서(확실한 것부터):
 *   1. 메모나 입금자명에 **인보이스 번호**가 있으면 그것. 사람이 적어준 답입니다.
 *   2. 남은 잔액과 **금액이 정확히 같은** 인보이스가 하나뿐이면 그것.
 *   3. 입금자명이 학생 이름과 **같고** 잔액이 남은 인보이스가 하나뿐이면 그것.
 *
 * 하나로 좁혀지지 않으면 **아무것도 고르지 않습니다.** 후보를 함께 돌려주어 사람이 고르게 합니다.
 */
export function matchPayment(
  p: { amount: number; payerName: string; memo: string },
  invoices: Invoice[],
  payments: PaymentRow[],
): { picked: Invoice | null; reason: string; candidates: MatchCandidate[] } {
  const open = invoices.filter((v) => v.status === "발행" && balanceOf(v, payments).balance > 0);
  const text = `${p.memo} ${p.payerName}`;

  // 1) 인보이스 번호가 적혀 있으면 그게 답입니다.
  const byNo = open.find((v) => text.includes(v.invoice_no));
  if (byNo) return { picked: byNo, reason: `번호 ${byNo.invoice_no}`, candidates: [] };

  // 2) 잔액이 딱 맞는 것.
  const exact = open.filter((v) => balanceOf(v, payments).balance === Math.round(p.amount));
  if (exact.length === 1) return { picked: exact[0], reason: "잔액과 금액 일치", candidates: [] };

  // 3) 이름이 같은 것.
  const key = norm(p.payerName);
  const byName = key.length >= 2
    ? open.filter((v) => norm(v.student_name_ko) === key || norm(v.student_name) === key)
    : [];
  if (byName.length === 1) return { picked: byName[0], reason: "입금자명이 학생 이름과 같음", candidates: [] };

  // 좁혀지지 않았습니다. 후보만 돌려주고 사람에게 맡깁니다.
  const cands: MatchCandidate[] = [
    ...exact.map((v) => ({ invoice: v, why: "금액 일치" })),
    ...byName.map((v) => ({ invoice: v, why: "이름 일치" })),
  ];
  const seen = new Set<string>();
  const uniq = cands.filter((c) => (seen.has(c.invoice.id) ? false : (seen.add(c.invoice.id), true)));
  return {
    picked: null,
    reason: uniq.length > 1 ? `후보 ${uniq.length}건 — 사람이 골라야 합니다` : "맞는 인보이스를 못 찾았습니다",
    candidates: uniq.slice(0, 6),
  };
}

/** "2026-09-01" 로 맞춥니다. 엑셀 날짜는 문자열·숫자·Date가 섞여 옵니다. */
export function toIsoDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const s = String(v ?? "").trim();
  // 2026-09-01 · 2026.09.01 · 2026/9/1
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // 엑셀 일련번호(1900-01-01 기준). 40000 근처면 날짜로 봅니다.
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return "";
}

/** "₩191,000" · "191000원" → 191000 */
export function toAmount(v: unknown): number {
  const s = String(v ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : 0;
}
