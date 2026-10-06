import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import AccountsClient from "@/components/finance/AccountsClient";
import type { AccountRow } from "@/lib/revenueAccounts";

export const dynamic = "force-dynamic";

/**
 * **세입과목 설정** — 과목 나무(관·항·목)와, 납부항목·분류를 어느 과목에 매달지.
 *
 * 매다는 자리는 셋입니다. 학비 항목(plan) · 학비외 분류 · 학비외 항목(분류와 다를 때만).
 * 항목마다 고르게 하면 학기마다 새로 생기는 수십 개를 매번 골라야 하고, 하나를 잊으면 그 돈이
 * 「미분류」로 떨어집니다. 분류에 한 번 정하면 그 아래 항목은 따라옵니다.
 */
export default async function AccountsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [acc, plans, cats, items] = await Promise.all([
    supabase.from("revenue_accounts").select("id, code, name, level, parent_id, sort_order, active, note").order("code"),
    supabase.from("fee_plans").select("id, name, category, active, revenue_account_id").order("category").order("sort_order").order("name"),
    supabase.from("fee_categories").select("id, name, revenue_account_id").order("sort_order").order("name"),
    supabase.from("fee_items").select("id, code, name, name_ko, category, revenue_account_id").order("category").order("code"),
  ]);
  const err = acc.error ?? plans.error ?? cats.error ?? items.error;

  return (
    <AccountsClient
      accounts={(acc.data as (AccountRow & { note: string | null })[] | null) ?? []}
      plans={(plans.data as { id: string; name: string; category: string; active: boolean; revenue_account_id: string | null }[] | null) ?? []}
      categories={(cats.data as { id: string; name: string; revenue_account_id: string | null }[] | null) ?? []}
      items={(items.data as { id: string; code: string | null; name: string; name_ko: string | null; category: string; revenue_account_id: string | null }[] | null) ?? []}
      loadError={err?.message ?? null}
    />
  );
}
