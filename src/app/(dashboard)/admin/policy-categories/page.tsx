import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { PolicyCategory } from "@/lib/types";
import PolicyCategoriesClient from "@/components/admin/PolicyCategoriesClient";

export const dynamic = "force-dynamic";

// 운영계획안(학부모용)/매뉴얼(실무자용) 고정 항목 목록 관리 화면입니다(요청: "모든 항목들
// (시스템의항목들이나, 매뉴얼, 운영계획안의 항목들)은 편집 가능하도록"). 관리자 전용이던
// GIA시스템과 달리, 이 화면은 확인된 요청("관리자·행정직원까지" 편집 가능)에 따라 처음부터
// 행정직원에게도 열어둡니다.
export default async function PolicyCategoriesPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const { data } = await supabase
    .from("policy_categories")
    .select("*")
    .order("target_doc", { ascending: true })
    .order("domain", { ascending: true })
    .order("sort_order", { ascending: true });

  return <PolicyCategoriesClient initialCategories={(data as PolicyCategory[] | null) ?? []} />;
}
