import type { SupabaseClient } from "@supabase/supabase-js";
import { planApply, splitMemo, type PrepaidPayment } from "@/lib/prepaid";

/**
 * 새로 만든 청구서에 **남은 선입금을 저절로 붙입니다.**
 *
 * ── 왜 자동인가 ──────────────────────────────────────────────────────
 *
 * 먼저 받아둔 돈이 있는데 청구서가 「미납」으로 뜨면, 담당자는 그 아이에게 독촉을 하게
 * 됩니다. 이미 낸 학부모에게 다시 내라고 하는 것이 이 화면이 낼 수 있는 가장 나쁜 답입니다.
 *
 * 붙이는 규칙은 `@/lib/prepaid` 한 곳에 있고(시험 가능), 여기서는 그 계획대로 표를
 * 고칩니다. 두 곳에서 각자 계산하면 화면과 저장이 다른 답을 냅니다.
 *
 * ── 조용히 실패하지 않습니다 ─────────────────────────────────────────
 *
 * 붙이다 실패하면 **청구서는 그대로 두고 사실만 알립니다.** 청구서를 지우면 방금 만든
 * 종이가 사라지고, 그냥 넘어가면 이미 받은 돈이 미납으로 남습니다. 둘 다 나쁘므로,
 * 사람이 볼 수 있는 자리에 이유를 올립니다.
 */
export async function applyPrepaid(
  supabase: SupabaseClient,
  invoice: { id: string; invoice_no: string; student_id: string | null; total_amount: number },
  actor: string,
): Promise<{ applied: number; error: string | null }> {
  if (!invoice.student_id || invoice.total_amount <= 0) return { applied: 0, error: null };

  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, paid_at, payer_name")
    .eq("student_id", invoice.student_id)
    .is("invoice_id", null)
    .order("paid_at");
  if (error) return { applied: 0, error: `남은 선입금을 읽지 못했습니다: ${error.message}` };

  const list: PrepaidPayment[] = ((data as { id: string; amount: number | string; paid_at: string; payer_name: string | null }[] | null) ?? []).map(
    (r) => ({ id: r.id, amount: Number(r.amount), paidAt: r.paid_at, payerName: r.payer_name }),
  );
  if (list.length === 0) return { applied: 0, error: null };

  const plan = planApply(list, Number(invoice.total_amount));
  if (plan.applied <= 0) return { applied: 0, error: null };

  if (plan.whole.length > 0) {
    const { error: upErr } = await supabase
      .from("payments")
      .update({ invoice_id: invoice.id, matched_by: "선입금 자동충당" })
      .in("id", plan.whole);
    if (upErr) return { applied: 0, error: `선입금을 붙이지 못했습니다: ${upErr.message}` };
  }

  if (plan.split) {
    const src = list.find((p) => p.id === plan.split!.id);
    if (src) {
      // 남는 돈을 **먼저** 떼어냅니다. 순서를 뒤집으면, 가운데서 끊겼을 때 원래 줄은 이미
      // 줄어 있고 남은 줄은 없어서 그만큼의 돈이 통째로 사라집니다.
      const { error: newErr } = await supabase.from("payments").insert({
        student_id: invoice.student_id,
        invoice_id: null,
        paid_at: src.paidAt,
        amount: plan.split.leftover,
        payer_name: src.payerName ?? null,
        memo: splitMemo(src.amount, plan.split.applied, invoice.invoice_no),
        source: "쪼갬",
        split_from_id: src.id,
        created_by: actor,
      });
      if (newErr) return { applied: 0, error: `남은 선입금을 나누지 못했습니다: ${newErr.message}` };

      const { error: cutErr } = await supabase
        .from("payments")
        .update({
          invoice_id: invoice.id,
          amount: plan.split.applied,
          matched_by: "선입금 자동충당",
          memo: splitMemo(src.amount, plan.split.applied, invoice.invoice_no),
        })
        .eq("id", src.id);
      if (cutErr) return { applied: 0, error: `선입금을 나눠 붙이지 못했습니다: ${cutErr.message}` };
    }
  }

  return { applied: plan.applied, error: null };
}
