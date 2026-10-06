import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { readAll, readNotice } from "@/lib/financeFetch";
import { buildRevenueReport, monthOf, type AccountCtx, type AccountRow, type RevInvoice, type RevLine, type RevPayment } from "@/lib/revenueAccounts";
import RevenueClient from "@/components/finance/RevenueClient";

export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-\d{2}$/;

function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = y * 12 + (mo - 1) + by;
  return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, "0")}`;
}

/**
 * **과목별 수입현황** — 세입과목(관·항·목)마다 부과 · 수납 · 결손 · 미수.
 *
 * 합계는 서버가 한 번만 셉니다(`revenueAccounts.ts`). 화면이 다시 더하면 위아래 숫자가 갈립니다.
 * 기간은 **청구월** 기준입니다 - 9월분을 10월에 낸 돈은 9월 수입으로 셉니다. 「그 달에 통장에
 * 들어온 돈」은 월별 화면이 따로 보여줍니다.
 */
export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const sp = await searchParams;
  const thisMonth = todayKst().slice(0, 7);
  const to = sp.to && MONTH.test(sp.to) ? sp.to : thisMonth;
  const from = sp.from && MONTH.test(sp.from) ? sp.from : shiftMonth(to, -11);

  const supabase = await createClient();
  const [accRes, itemRes, catRes, planRes] = await Promise.all([
    supabase.from("revenue_accounts").select("id, code, name, level, parent_id, sort_order, active").order("code"),
    supabase.from("fee_items").select("id, category, revenue_account_id"),
    supabase.from("fee_categories").select("name, revenue_account_id"),
    supabase.from("fee_plans").select("id, name, revenue_account_id"),
  ]);
  // 이월 줄은 기간 밖의 원래 청구서를 따라가야 하므로 청구서·줄은 기간으로 자르지 않고 읽습니다.
  const [invRes, lineRes, payRes] = await Promise.all([
    readAll<RevInvoice>((a, b) =>
      supabase
        .from("invoices")
        .select("id, status, stream, category, billing_month, issue_date, carried_to_invoice_id, written_off_amount")
        .order("issue_date")
        .order("id")
        .range(a, b),
    ),
    readAll<RevLine>((a, b) =>
      supabase
        .from("invoice_lines")
        .select("id, invoice_id, seq, name, amount, item_id, plan_id, carried_from_invoice_id, revenue_account_id")
        .order("invoice_id")
        .order("seq")
        .order("id")
        .range(a, b),
    ),
    readAll<RevPayment>((a, b) => supabase.from("payments").select("invoice_id, amount").order("id").range(a, b)),
  ]);

  const firstErr = accRes.error ?? itemRes.error ?? catRes.error ?? planRes.error;
  const accounts = (accRes.data as AccountRow[] | null) ?? [];
  const ctx: AccountCtx = {
    accounts,
    items: new Map(((itemRes.data ?? []) as { id: string; category: string | null; revenue_account_id: string | null }[]).map((x) => [x.id, { accountId: x.revenue_account_id, category: x.category }])),
    categories: new Map(((catRes.data ?? []) as { name: string; revenue_account_id: string | null }[]).map((x) => [x.name, x.revenue_account_id])),
    plans: new Map(((planRes.data ?? []) as { id: string; name: string; revenue_account_id: string | null }[]).map((x) => [x.id, { accountId: x.revenue_account_id, name: x.name }])),
  };

  const report = buildRevenueReport(invRes.rows, lineRes.rows, payRes.rows, ctx, (v) => {
    const m = monthOf(v);
    return m >= from && m <= to;
  });

  return (
    <RevenueClient
      accounts={accounts}
      rows={report.rows}
      unresolved={report.unresolved}
      from={from}
      to={to}
      thisMonth={thisMonth}
      loadError={firstErr?.message ?? readNotice(invRes, lineRes, payRes)}
    />
  );
}
