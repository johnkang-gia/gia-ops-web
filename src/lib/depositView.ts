import type { SupabaseClient } from "@supabase/supabase-js";
import { groupLines, isFromDeposit } from "@/lib/depositLines";
import { todayKst } from "@/lib/kst";
import type { InvoiceLine } from "@/lib/types";

/**
 * 청구서·영수증에 찍을 **예치금 이야기** — 무엇을 예치금에서 냈고, 얼마가 남았나.
 *
 * 학부모에게 가는 종이입니다. 「예치금 차감 ₩250,000」만 적으면 무엇이 빠졌는지 되묻고,
 * 남은 예치금을 안 적으면 「제가 맡긴 돈은 어떻게 됐나요」를 묻습니다. 두 질문 모두 행정실이
 * 화면을 다시 열어 답해야 하는 일이라, 처음부터 종이에 적습니다.
 *
 * 남은 예치금은 **찍는 날 기준**입니다. 뺀 그 순간의 값을 따로 굳혀 두지 않았으므로, 날짜를
 * 함께 적어 「언제의 잔액인가」를 숨기지 않습니다.
 */

export type DepositItem = { name: string; amount: number; partial: boolean };
export type InvoiceDeposit = { deposit: number; otherPaid: number; items: DepositItem[]; lineIds: string[] };
export type DepositView = {
  byInvoice: Record<string, InvoiceDeposit>;
  /** 학생별 남은 예치금. */
  left: Record<string, number>;
  asOf: string;
};

const clean = (name: string) => name.replace(/^[\s　└]+/, "").trim();

export async function loadDepositView(
  supabase: SupabaseClient,
  parts: { invoice: { id: string; student_id: string | null }; lines: InvoiceLine[] }[],
): Promise<DepositView> {
  const ids = parts.map((p) => p.invoice.id);
  const students = [...new Set(parts.map((p) => p.invoice.student_id).filter((x): x is string => !!x))];
  const [payRes, depRes] = await Promise.all([
    supabase.from("payments").select("invoice_id, amount, matched_by, applied_line_id").in("invoice_id", ids),
    students.length > 0
      ? supabase.from("payments").select("student_id, amount").in("student_id", students).is("invoice_id", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  // 조용히 넘기지 않습니다(§5) - 예치금을 못 읽은 채 찍으면 이미 낸 돈이 「납부하실 금액」에 남습니다.
  if (payRes.error) throw new Error(`입금을 읽지 못했습니다: ${payRes.error.message}`);
  if (depRes.error) throw new Error(`남은 예치금을 읽지 못했습니다: ${depRes.error.message}`);

  type Pay = { invoice_id: string; amount: number | string; matched_by: string | null; applied_line_id: string | null };
  const pays = (payRes.data as Pay[] | null) ?? [];

  const byInvoice: Record<string, InvoiceDeposit> = {};
  for (const part of parts) {
    const mine = pays.filter((p) => p.invoice_id === part.invoice.id);
    const dep = mine.filter((p) => isFromDeposit(p.matched_by));
    const groups = groupLines(part.lines.map((l) => ({ id: l.id, name: l.name, amount: Number(l.amount) })));
    const items: DepositItem[] = [];
    const lineIds: string[] = [];
    for (const g of groups) {
      const got = dep.filter((p) => p.applied_line_id === g.id).reduce((n, p) => n + Number(p.amount), 0);
      if (got <= 0) continue;
      items.push({ name: clean(g.name), amount: got, partial: got < g.amount });
      lineIds.push(g.id);
    }
    // 항목을 안 정하고 붙인 옛 예치금(대장에서 통째로 붙인 것 등)도 금액은 빠졌으니 적습니다.
    const loose = dep.filter((p) => !p.applied_line_id || !groups.some((g) => g.id === p.applied_line_id)).reduce((n, p) => n + Number(p.amount), 0);
    if (loose > 0) items.push({ name: "항목 지정 없음", amount: loose, partial: false });
    byInvoice[part.invoice.id] = {
      deposit: dep.reduce((n, p) => n + Number(p.amount), 0),
      otherPaid: mine.filter((p) => !isFromDeposit(p.matched_by)).reduce((n, p) => n + Number(p.amount), 0),
      items,
      lineIds,
    };
  }

  const left: Record<string, number> = {};
  for (const r of (depRes.data as { student_id: string; amount: number | string }[] | null) ?? []) {
    left[r.student_id] = (left[r.student_id] ?? 0) + Number(r.amount);
  }
  for (const s of students) left[s] = Math.max(0, left[s] ?? 0);

  return { byInvoice, left, asOf: todayKst() };
}
