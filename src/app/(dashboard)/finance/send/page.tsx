import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { readAll } from "@/lib/financeFetch";
import { loadStudentsWithPhones } from "@/lib/students";
import { billingPhoneOf, phoneOf, phonesOf, ROLE_ORDER, type GuardianRole } from "@/lib/alltalkpay";
import { roundLabel } from "@/lib/invoiceRound";
import SendClient, { type SendRow } from "@/components/finance/SendClient";

import { getFinanceScope, scopeStudentIds, inScopeIds } from "@/lib/financeScopeServer";
export const dynamic = "force-dynamic";

/**
 * **올톡 보내기** — 발행한 청구서를 실제로 올톡페이로 청구하는 화면.
 *
 * 청구서를 만드는 화면은 여럿인데(학생별·학비 일괄·학비외 일괄) 「아직 안 보낸 청구서」를 한
 * 곳에서 보는 자리가 없었습니다. 9/1~10/8 발행분 중 앱에서 「보냄」 표시가 된 장이 0장이었고,
 * 담당자는 올톡페이 화면에서 금액을 옮겨 적어 따로 보냈습니다. 그러면 결과를 받았을 때 청구서
 * 번호가 없어 금액으로 짝을 짐작해야 합니다.
 *
 * 여기서는 안 보낸 장을 모아 보고, 학생마다 **실제로 나갈 번호**를 그 자리에서 고르거나 새로
 * 적고, 골라서 올톡 등록 파일을 만듭니다. 파일의 청구사유 앞에는 청구서 번호가 붙습니다.
 */
export default async function FinanceSendPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  type Inv = {
    id: string;
    invoice_no: string;
    student_id: string | null;
    student_name: string;
    student_name_ko: string | null;
    total_amount: number | string;
    billing_month: string | null;
    issue_date: string;
    issue_batch: string | null;
    stream: string | null;
    category: string | null;
    exported_at: string | null;
    issued_offline: boolean | null;
    carried_to_invoice_id: string | null;
    written_off_amount: number | string | null;
  };
  const [invRes, payRes, stuRes] = await Promise.all([
    readAll<Inv>((from, to) =>
      supabase
        .from("invoices")
        .select("id, invoice_no, student_id, student_name, student_name_ko, total_amount, billing_month, issue_date, issue_batch, stream, category, exported_at, issued_offline, carried_to_invoice_id, written_off_amount")
        .eq("status", "발행")
        .order("invoice_no")
        .range(from, to),
    ),
    readAll<{ invoice_id: string | null; amount: number | string }>((from, to) =>
      supabase.from("payments").select("invoice_id, amount").not("invoice_id", "is", null).order("id").range(from, to),
    ),
    loadStudentsWithPhones(supabase, { status: "all" }),
  ]);
  const error = invRes.error ?? payRes.error ?? stuRes.error;

  const paid = new Map<string, number>();
  for (const p of payRes.rows) if (p.invoice_id) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Math.round(Number(p.amount)));
  const stuById = new Map(stuRes.rows.map((s) => [s.id, s]));

  const rows: SendRow[] = [];
  for (const v of invRes.rows) {
    // 직접 받은 장은 보낼 것이 없습니다(보내면 이미 낸 분께 또 내라는 문자가 갑니다). 이월된 장은 다음 장으로 갑니다.
    if (v.issued_offline || v.carried_to_invoice_id) continue;
    const total = Math.round(Number(v.total_amount));
    const balance = total - (paid.get(v.id) ?? 0) - Math.round(Number(v.written_off_amount ?? 0));
    if (balance <= 0) continue;
    const s = v.student_id ? stuById.get(v.student_id) : undefined;
    const billing = s
      ? {
          billing_phone_role: s.billing_phone_role ?? null,
          billing_phone: s.billing_phone ?? null,
          mother_phone: s.mother_phone ?? null,
          father_phone: s.father_phone ?? null,
          parent_phone: s.parent_phone ?? null,
        }
      : null;
    const phones = billing ? phonesOf(billing) : null;
    const picked = billing ? billingPhoneOf(billing) : null;
    rows.push({
      id: v.id,
      invoiceNo: v.invoice_no,
      studentId: v.student_id,
      name: s?.name ?? v.student_name_ko ?? v.student_name,
      where: s?.class_name ?? "",
      label: roundLabel(v),
      billingMonth: v.billing_month || v.issue_date.slice(0, 7),
      stream: v.stream === "학비" || v.category === "학비" ? "학비" : "학비외",
      total,
      balance,
      exportedAt: v.exported_at,
      role: (picked?.role ?? null) as GuardianRole | null,
      options: phones
        ? ROLE_ORDER.map((role) => ({ role, phone: phoneOf(phones, role) })).filter((o): o is { role: GuardianRole; phone: string } => o.phone !== null)
        : [],
    });
  }

  return <SendClient rows={rows} error={error} />;
}
