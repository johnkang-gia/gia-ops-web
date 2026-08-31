import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isAdminUser } from "@/lib/roles";
import { ensureChecklistItemsForTerm } from "@/lib/academicChecklist";
import type { ChecklistItem, ChecklistMeeting, ChecklistTemplate, FormImportTemplate } from "@/lib/types";
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

  // 항목에 딸린 회의(요청 ⑤). 항목만 보여주고 회의를 안 보여주면 "회의 필요"를 켜도
  // 아무 일도 안 일어난 것처럼 보입니다 - 실제로는 만들어졌는데 화면이 안 비추는 것뿐입니다.
  const itemIds = items.map((i) => i.id);
  const { data: meetingRows } = itemIds.length
    ? await supabase
        .from("academic_checklist_meetings")
        .select("*")
        .in("item_id", itemIds)
        .order("meet_date")
    : { data: [] };
  const meetings = (meetingRows as ChecklistMeeting[] | null) ?? [];

  // 요청("그것에 학사일정에 기록으로 남아서") - 신청서 탭에서 이 학기 유형으로 붙여넣어둔
  // 구글폼 템플릿이 있으면, 지금 학기 화면에서도 바로 보이도록 작게 보여줍니다(자세한 지난
  // 회차 비교는 학기준비 화면에서).
  let formTemplates: FormImportTemplate[] = [];
  if (currentTerm) {
    const { data: templatesFormData } = await supabase
      .from("form_import_templates")
      .select("*")
      .eq("term_type", currentTerm.term_type)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .limit(5);
    formTemplates = (templatesFormData as FormImportTemplate[] | null) ?? [];
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-3 overflow-hidden">
      {currentTerm && formTemplates.length > 0 && (
        <div className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-600">
              📋 이 학기({currentTerm.year}년 {currentTerm.term_type}) 신청서 템플릿
            </p>
            <Link href="/academic-calendar/prep" className="text-[11px] text-wr-primary hover:underline">
              지난 학기와 비교해서 보기 →
            </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {formTemplates.map((t) => (
              <span key={t.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">
                {t.purpose || t.name}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <AcademicCalendarClient
          items={items}
          templates={templates}
          currentTerm={currentTerm}
          isAdmin={isAdmin}
          meetings={meetings}
          currentUserEmail={me.email}
        />
      </div>
    </div>
  );
}
