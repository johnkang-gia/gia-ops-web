import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import InvoiceSheet from "@/components/finance/InvoiceSheet";
import type { Invoice, InvoiceLine } from "@/lib/types";
import { invoiceFileTitle } from "@/lib/invoiceTitle";

export const dynamic = "force-dynamic";

/**
 * **PDF 파일 이름은 탭 제목에서 나옵니다.**
 *
 * 브라우저의 「PDF로 저장」은 `document.title` 을 그대로 파일 이름으로 씁니다. 두지 않으면
 * 139명 것이 전부 「GIA 운영」으로 저장되고, 받는 쪽은 열어봐야 누구 것인지 압니다.
 *
 * **화면에서 `document.title` 을 고치는 것으로는 안 됩니다** - Next 가 이 화면의 metadata
 * 로 제목을 다시 덮어씁니다. 그래서 서버에서 정합니다.
 *
 * 여기서 실패해도 화면은 떠야 합니다. 제목을 못 정하는 것보다 청구서가 안 나오는 것이
 * 훨씬 나쁩니다.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data } = await supabase
      .from("invoices")
      .select("student_name, student_name_ko, grade_label, stream, category")
      .eq("id", id)
      .maybeSingle();
    if (!data) return { title: "청구서" };
    return { title: invoiceFileTitle(data as Parameters<typeof invoiceFileTitle>[0]) };
  } catch {
    return { title: "청구서" };
  }
}

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
