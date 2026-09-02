import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import PaymentsClient from "@/components/finance/PaymentsClient";
import type { PaymentRow } from "@/lib/payments";
import type { Invoice } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [invRes, payRes] = await Promise.all([
    supabase.from("invoices").select("*").order("issue_date", { ascending: false }).limit(1000),
    supabase.from("payments").select("*").order("paid_at", { ascending: false }).limit(1000),
  ]);

  return (
    <PaymentsClient
      invoices={(invRes.data as Invoice[] | null) ?? []}
      payments={(payRes.data as PaymentRow[] | null) ?? []}
      currentUserEmail={me.email}
      currentUserName={me.name ?? ""}
      loadError={invRes.error?.message ?? payRes.error?.message ?? null}
      today={todayKst()}
    />
  );
}
