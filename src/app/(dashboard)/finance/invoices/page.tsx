import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import InvoiceGridClient, { type Student } from "@/components/finance/InvoiceGridClient";
import type { FeeItem, Invoice, StudentFeeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  // 명부는 **원본 표**에서 읽습니다. 공용 뷰(wr_students_basic)에도 학생이 있지만, 이 화면은
  // 돈에 관한 화면이라 재무 권한으로만 열리고 필요한 칸이 전부 원본에 있습니다.
  const [stuRes, itemsRes, ovRes, invRes] = await Promise.all([
    supabase.from("wr_students").select("id, name, name_en, grade, class_name").eq("status", "active").eq("is_demo", false).order("grade").order("name"),
    supabase.from("fee_items").select("*").order("category").order("sort_order").order("name"),
    supabase.from("student_fee_items").select("*"),
    supabase.from("invoices").select("*").order("issue_date", { ascending: false }).order("created_at", { ascending: false }).limit(300),
  ]);

  const students: Student[] = (
    (stuRes.data as { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null }[] | null) ?? []
  ).map((s) => ({ id: s.id, name: s.name, nameEn: s.name_en, grade: s.grade, className: s.class_name }));

  const loadError = stuRes.error?.message ?? itemsRes.error?.message ?? ovRes.error?.message ?? invRes.error?.message ?? null;

  return (
    <InvoiceGridClient
      students={students}
      items={(itemsRes.data as FeeItem[] | null) ?? []}
      initialOverrides={(ovRes.data as StudentFeeItem[] | null) ?? []}
      recentInvoices={(invRes.data as Invoice[] | null) ?? []}
      currentUserEmail={me.email}
      loadError={loadError}
      today={todayKst()}
    />
  );
}
