import type { SupabaseClient } from "@supabase/supabase-js";
import {
  carryForwardCandidates,
  carryForwardLineName,
  type InvoiceStream,
  type SettleInvoice,
  type SettlePayment,
} from "./settlement";

/**
 * 새 청구서에 **이전 미납을 얹습니다.**
 *
 * 학부모는 한 장만 보면 됩니다. 대신 원 청구서를 「이월됨」으로 잠가야 합니다 - 안 그러면
 * 같은 돈이 두 곳에 미납으로 남아 두 번 청구됩니다.
 *
 * 잠그는 것은 **새 청구서를 만든 뒤**입니다. 먼저 잠그면, 청구서 만들다 실패했을 때 원 미납이
 * 어디로도 가지 않은 채 사라집니다.
 */

export type CarryLine = {
  name: string;
  qty: number;
  unit_price: number;
  amount: number;
  carried_from_invoice_id: string;
};

const COLS =
  "id, invoice_no, student_id, student_name, student_name_ko, issue_date, due_date, total_amount, status, category, stream, carried_to_invoice_id";

/** 이 학생·이 갈래에서 아직 안 받은 돈. 새 청구서에 넣을 줄로 만들어 돌려줍니다. */
export async function planCarryForward(
  supabase: SupabaseClient,
  opts: { studentId: string; stream: InvoiceStream; today: string },
): Promise<{ lines: CarryLine[]; total: number; lockIds: string[]; error: string | null }> {
  const { data: invs, error: invErr } = await supabase.from("invoices").select(COLS).eq("student_id", opts.studentId);
  if (invErr) return { lines: [], total: 0, lockIds: [], error: invErr.message };

  const ids = (invs ?? []).map((v) => (v as { id: string }).id);
  if (ids.length === 0) return { lines: [], total: 0, lockIds: [], error: null };

  const { data: pays, error: payErr } = await supabase
    .from("payments")
    .select("invoice_id, amount")
    .in("invoice_id", ids);
  if (payErr) return { lines: [], total: 0, lockIds: [], error: payErr.message };

  const cands = carryForwardCandidates((invs ?? []) as unknown as SettleInvoice[], (pays ?? []) as SettlePayment[], {
    studentId: opts.studentId,
    stream: opts.stream,
    today: opts.today,
  });

  const lines: CarryLine[] = cands.map((c) => ({
    name: carryForwardLineName(c.invoice),
    qty: 1,
    unit_price: c.balance,
    amount: c.balance,
    carried_from_invoice_id: c.invoice.id,
  }));

  return {
    lines,
    total: lines.reduce((n, l) => n + l.amount, 0),
    lockIds: cands.map((c) => c.invoice.id),
    error: null,
  };
}

/**
 * 원 청구서를 「이월됨」으로 잠급니다.
 *
 * 실패를 삼키지 않습니다. 여기서 조용히 넘어가면 같은 돈이 두 곳에 미납으로 남고, 다음 달에
 * 또 이월되어 **금액이 눈덩이처럼 불어납니다.**
 */
export async function lockCarried(
  supabase: SupabaseClient,
  lockIds: string[],
  newInvoiceId: string,
): Promise<string | null> {
  if (lockIds.length === 0) return null;
  const { error } = await supabase
    .from("invoices")
    .update({ carried_to_invoice_id: newInvoiceId })
    .in("id", lockIds)
    .is("carried_to_invoice_id", null);
  return error ? error.message : null;
}
