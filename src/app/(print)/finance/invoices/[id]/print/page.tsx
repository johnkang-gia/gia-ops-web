import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import InvoiceSheet from "@/components/finance/InvoiceSheet";
import type { Invoice, InvoiceLine } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ embed?: string }>;
}) {
  const { id } = await params;
  const { embed } = await searchParams;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [invRes, lineRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("seq"),
  ]);
  if (invRes.error) throw new Error(`인보이스를 읽지 못했습니다: ${invRes.error.message}`);
  const invoice = invRes.data as Invoice | null;
  if (!invoice) notFound();

  return <InvoiceSheet invoice={invoice} lines={(lineRes.data as InvoiceLine[] | null) ?? []} embed={embed === "1"} />;
}
