import type { SupabaseClient } from "@supabase/supabase-js";
import { departmentOf, gradeSortKey } from "@/lib/department";
import type { FeeCategory, FeeItem, StudentGroup, Term } from "@/lib/types";

/**
 * **학비외 항목 화면이 쓰는 자료를 모으는 자리 — 한 곳입니다.**
 *
 * 이 화면은 두 자리에서 열립니다: 자기 주소(`/finance/items`)와, 청구 · 학비외 표 위의
 * 팝업. 두 자리가 각자 조회를 적으면 **어느 날 한쪽에만 칸이 늘어납니다** - 그러면 같은
 * 화면인데 팝업에서는 중고등부 학년이 안 뜨는 식이 되고, 오류가 아니라 「고를 것이 없는
 * 화면」으로 보입니다.
 */

export type FeeItemsPanel = {
  initialItems: FeeItem[];
  initialCategories: FeeCategory[];
  terms: Term[];
  gradesByDept: Record<string, string[]>;
  classesByDept: Record<string, string[]>;
  classesByGrade: Record<string, Record<string, string[]>>;
  groups: StudentGroup[];
  usageByItem: Record<string, number>;
  loadError: string | null;
};

export async function loadFeeItemsPanel(supabase: SupabaseClient): Promise<FeeItemsPanel> {
  const [itemsRes, catRes, termRes, clsRes, stuRes, useRes, groupRes] = await Promise.all([
    supabase.from("fee_items").select("*").order("category").order("sort_order").order("name"),
    supabase.from("fee_categories").select("*").order("sort_order").order("name"),
    supabase
      .from("terms")
      .select("*")
      .order("status")
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("wr_classes").select("grade, class_name, department").eq("is_demo", false).order("grade").order("class_name"),
    // 중고등부는 반이 없는 학년이 있어서 반 표만 보면 학년이 통째로 빠집니다. 명부에서도
    // 학년·반을 모아 합칩니다 - 항목의 기본 대상을 고를 수 없으면 그 학년은 등록이 안 됩니다.
    supabase.from("wr_students").select("grade, class_name, department").eq("is_demo", false).in("status", ["active", "재학"]),
    // 항목을 지울 때 "이 조정이 몇 명분 함께 사라지는지" 를 보여주기 위한 것입니다.
    supabase.from("student_fee_items").select("item_id"),
    supabase.from("student_groups").select("*").eq("is_demo", false).order("kind").order("name"),
  ]);

  // 분류·학기 표가 아직 없어도(마이그레이션 전) 화면은 열려야 합니다.
  if (catRes.error) console.error("[학비외 항목] 분류를 읽지 못했습니다:", catRes.error.message);
  if (termRes.error) console.error("[학비외 항목] 학기를 읽지 못했습니다:", termRes.error.message);
  if (stuRes.error) console.error("[학비외 항목] 명부를 읽지 못했습니다:", stuRes.error.message);
  if (useRes.error) console.error("[학비외 항목] 아이별 가감을 읽지 못했습니다:", useRes.error.message);

  type Row = { grade: string | null; class_name: string | null; department: string | null };
  const rows = [...(((clsRes.data as Row[] | null) ?? [])), ...(((stuRes.data as Row[] | null) ?? []))];

  const gradesByDept: Record<string, string[]> = {};
  const classesByDept: Record<string, string[]> = {};
  const classesByGrade: Record<string, Record<string, string[]>> = {};
  for (const r of rows) {
    const dept = departmentOf({ department: r.department, grade: r.grade });
    if (dept !== "초등부" && dept !== "중고등부") continue;
    const g = (r.grade ?? "").trim();
    const c = (r.class_name ?? "").trim();
    if (g) (gradesByDept[dept] ??= []).push(g);
    if (c) (classesByDept[dept] ??= []).push(c);
    if (g && c) ((classesByGrade[dept] ??= {})[g] ??= []).push(c);
  }
  for (const d of Object.keys(gradesByDept)) {
    gradesByDept[d] = [...new Set(gradesByDept[d])].sort((a, b) => gradeSortKey(a) - gradeSortKey(b));
  }
  for (const d of Object.keys(classesByDept)) {
    classesByDept[d] = [...new Set(classesByDept[d])].sort((a, b) => a.localeCompare(b, "ko"));
  }
  for (const d of Object.keys(classesByGrade)) {
    for (const g of Object.keys(classesByGrade[d])) {
      classesByGrade[d][g] = [...new Set(classesByGrade[d][g])].sort((a, b) => a.localeCompare(b, "ko"));
    }
  }

  // `공통` 탭(학교 전체가 사는 것)에서는 양쪽을 다 보여줍니다.
  const allGrades = [...new Set(Object.values(gradesByDept).flat())].sort((a, b) => gradeSortKey(a) - gradeSortKey(b));
  const allClasses = [...new Set(Object.values(classesByDept).flat())].sort((a, b) => a.localeCompare(b, "ko"));
  const allByGrade: Record<string, string[]> = {};
  for (const d of Object.keys(classesByGrade)) {
    for (const g of Object.keys(classesByGrade[d])) {
      allByGrade[g] = [...new Set([...(allByGrade[g] ?? []), ...classesByGrade[d][g]])].sort((a, b) => a.localeCompare(b, "ko"));
    }
  }

  const usageByItem: Record<string, number> = {};
  for (const r of ((useRes.data as { item_id: string }[] | null) ?? [])) {
    usageByItem[r.item_id] = (usageByItem[r.item_id] ?? 0) + 1;
  }

  return {
    initialItems: (itemsRes.data as FeeItem[] | null) ?? [],
    initialCategories: (catRes.data as FeeCategory[] | null) ?? [],
    terms: (termRes.data as Term[] | null) ?? [],
    gradesByDept: { ...gradesByDept, 공통: allGrades },
    classesByDept: { ...classesByDept, 공통: allClasses },
    classesByGrade: { ...classesByGrade, 공통: allByGrade },
    groups: (groupRes.data as StudentGroup[] | null) ?? [],
    usageByItem,
    loadError: itemsRes.error?.message ?? null,
  };
}
