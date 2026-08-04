import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isAdminUser } from "@/lib/roles";
import { ensureChecklistItemsForTerm } from "@/lib/academicChecklist";
import type { ChecklistItem, ChecklistTemplate } from "@/lib/types";
import AcademicCalendarClient from "@/components/academic/AcademicCalendarClient";

export const dynamic = "force-dynamic";

// "학사일정" - 학기 시작 2주 전엔 뭘 하고 1주 전엔 뭘 하는지를 달력으로 한눈에 보고, 모든
// 직원이 체크할 수 있게 만든 화면입니다(요청). 관리자가 미리 만들어둔 반복 체크리스트
// 템플릿을, 지금 진행중인 학기의 시작일/종료일 기준으로 실제 날짜가 붙은 항목으로 자동
// 생성해서 보여줍니다 - 학기가 바뀔 때마다 매번 새로 등록할 필요 없이 이 페이지를 열기만
// 하면 그 학기치 항목이 채워집니다.
export default async function AcademicCalendarPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const isAdmin = isAdminUser(me);

  const [currentTerm, { data: templatesData }] = await Promise.all([
    getCurrentTerm(),
    supabase.from("academic_checklist_templates").select("*").order("sort_order", { ascending: true }),
  ]);
  const templates = (templatesData as ChecklistTemplate[] | null) ?? [];

  if (currentTerm) {
    await ensureChecklistItemsForTerm(supabase, currentTerm, templates);
  }

  const { data: itemsData } = await supabase
    .from("academic_checklist_items")
    .select("*")
    .order("due_date", { ascending: true });
  const items = (itemsData as ChecklistItem[] | null) ?? [];

  return (
    <AcademicCalendarClient
      items={items}
      templates={templates}
      currentTerm={currentTerm}
      isAdmin={isAdmin}
      currentUserEmail={me.email}
    />
  );
}
