import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { readAll, readNotice } from "@/lib/financeFetch";
import { decideBlock } from "@/lib/financeRequests";
import ApprovalsClient, { type ApprovalRow } from "@/components/finance/ApprovalsClient";
import type { FinanceRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * **결재** — 결손·환불 요청을 승인하거나 반려합니다.
 *
 * 승인할 수 없는 사람에게도 목록은 보입니다(올린 사람이 「아직 대기인가」를 확인해야 합니다).
 * 단추 자리에는 **왜 못 누르는지**를 적습니다 - 단추를 숨기면 「누가 해야 하나」를 모릅니다.
 */
export default async function ApprovalsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const res = await readAll<FinanceRequest & { invoices: { invoice_no: string; student_name: string; student_name_ko: string | null; total_amount: number | string; stream: string | null } | null }>(
    (from, to) =>
      supabase
        .from("finance_requests")
        .select("*, invoices(invoice_no, student_name, student_name_ko, total_amount, stream)")
        .order("requested_at", { ascending: false })
        .order("id")
        .range(from, to),
  );

  const rows: ApprovalRow[] = res.rows.map((r) => ({
    ...r,
    invoiceNo: r.invoices?.invoice_no ?? "",
    studentName: r.invoices?.student_name_ko || r.invoices?.student_name || "",
    invoiceTotal: Number(r.invoices?.total_amount ?? 0),
    stream: r.invoices?.stream ?? null,
    block: decideBlock(me, r),
    mine: r.requested_by.toLowerCase() === me.email.toLowerCase(),
  }));

  return <ApprovalsClient rows={rows} loadError={readNotice(res)} />;
}
