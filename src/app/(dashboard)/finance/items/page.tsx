import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import FeeItemsClient from "@/components/finance/FeeItemsClient";
import { departmentOf, gradeSortKey } from "@/lib/department";
import type { FeeCategory, FeeItem, Term } from "@/lib/types";

// 학비외 항목 등록(재무 전용).
//
// 화면 단에서 한 번, DB(RLS)에서 또 한 번 막습니다. 화면만 막으면 주소를 직접 치는 것으로
// 뚫리고, RLS만 막으면 화면이 빈 채로 떠서 "고장난 건가" 싶어집니다.

export const dynamic = "force-dynamic";

export default async function FeeItemsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [itemsRes, catRes, termRes, clsRes, stuRes] = await Promise.all([
    supabase.from("fee_items").select("*").order("category").order("sort_order").order("name"),
    supabase.from("fee_categories").select("*").order("sort_order").order("name"),
    supabase.from("terms").select("*").order("status").order("start_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
    supabase.from("wr_classes").select("grade, class_name, department").eq("is_demo", false).order("grade").order("class_name"),
    // 중고등부는 반이 없는 학년이 있어서 반 표만 보면 학년이 통째로 빠집니다. 명부에서도
    // 학년·반을 모아 합칩니다 - 항목의 기본 대상을 고를 수 없으면 그 학년은 등록이 안 됩니다.
    supabase
      .from("wr_students")
      .select("grade, class_name, department")
      .eq("is_demo", false)
      .in("status", ["active", "재학"]),
  ]);
  // 분류 표가 아직 없어도(마이그레이션 전) 화면은 열려야 합니다. 그때는 항목에 적힌 글자로만
  // 분류가 만들어집니다 - 예전과 같은 동작입니다.
  if (catRes.error) console.error("[학비외 항목] 분류를 읽지 못했습니다:", catRes.error.message);
  // 학기 표가 아직 없어도(마이그레이션 전) 화면은 열려야 합니다. 그때는 학기 고르개가
  // "SQL을 먼저 실행해주세요"로 뜹니다.
  if (termRes.error) console.error("[학비외 항목] 학기를 읽지 못했습니다:", termRes.error.message);

  /**
   * 부서별 학년·반 목록.
   *
   * 예전에는 반 표에서 한 벌만 만들어 초등·중고등에 똑같이 썼습니다. 그래서 **중고등부
   * 항목을 만들 때도 초등 학년(2~5)과 초등 반(G2A…)이 떴습니다.** 고를 수 있는 것이 남의
   * 부서 것뿐이면 기본 대상을 제대로 못 정하고, 결국 아이마다 손으로 체크하게 됩니다.
   *
   * 반 표만 보면 중고등처럼 반이 없는 학년이 통째로 빠지므로 명부에서도 모아 합칩니다.
   */
  type Row = { grade: string | null; class_name: string | null; department: string | null };
  const rows = [
    ...(((clsRes.data as Row[] | null) ?? [])),
    ...(((stuRes.data as Row[] | null) ?? [])),
  ];
  if (stuRes.error) console.error("[학비외 항목] 명부를 읽지 못했습니다:", stuRes.error.message);

  const gradesByDept: Record<string, string[]> = {};
  const classesByDept: Record<string, string[]> = {};
  for (const r of rows) {
    const dept = departmentOf({ department: r.department, grade: r.grade });
    if (dept !== "초등부" && dept !== "중고등부") continue;
    const g = (r.grade ?? "").trim();
    const c = (r.class_name ?? "").trim();
    if (g) (gradesByDept[dept] ??= []).push(g);
    if (c) (classesByDept[dept] ??= []).push(c);
  }
  for (const d of Object.keys(gradesByDept)) {
    gradesByDept[d] = [...new Set(gradesByDept[d])].sort((a, b) => gradeSortKey(a) - gradeSortKey(b));
  }
  for (const d of Object.keys(classesByDept)) {
    classesByDept[d] = [...new Set(classesByDept[d])].sort((a, b) => a.localeCompare(b, "ko"));
  }
  // `공통` 탭(학교 전체가 사는 것)에서는 양쪽을 다 보여줍니다.
  const allGrades = [...new Set(Object.values(gradesByDept).flat())].sort((a, b) => gradeSortKey(a) - gradeSortKey(b));
  const allClasses = [...new Set(Object.values(classesByDept).flat())].sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <FeeItemsClient
      initialItems={(itemsRes.data as FeeItem[] | null) ?? []}
      initialCategories={(catRes.data as FeeCategory[] | null) ?? []}
      terms={(termRes.data as Term[] | null) ?? []}
      gradesByDept={{ ...gradesByDept, 공통: allGrades }}
      classesByDept={{ ...classesByDept, 공통: allClasses }}
      currentUserEmail={me.email}
      loadError={itemsRes.error?.message ?? null}
    />
  );
}
