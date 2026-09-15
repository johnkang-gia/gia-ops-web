import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import SubjectManageClient from "@/components/weeklyReport/admin/SubjectManageClient";
import GuideButton from "@/components/common/GuideButton";
import TermSettingTabs from "@/components/school/TermSettingTabs";
import { TermSnapshotSubjects } from "@/components/school/TermSnapshotView";
import { loadTermSettingView } from "@/lib/termSettingView";
import { loadSubjectsPanel } from "@/lib/panels/subjects";

const GUIDE_SECTIONS = [
  {
    title: "📘 과목반 세팅이란?",
    lines: ["과목을 등록하고 각 과목의 담당 교사, 수강 학생 명단을 지정합니다. 여기서 지정한 담당 교사는 해당 과목의 위클리 리포트를 작성할 수 있습니다."],
  },
];

export const dynamic = "force-dynamic";

export default async function SubjectManagePage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/weekly-report");

  const sp = await searchParams;
  const view = await loadTermSettingView(supabase, sp.term);

  // 이 화면은 [반/담임] 위의 팝업에서도 열립니다. 자료를 모으는 일은 **같은 함수**를
  // 씁니다 - 두 곳에 적으면 어느 날 한쪽에만 칸이 늘고, 그러면 같은 화면이 두 답을 합니다.
  const d = await loadSubjectsPanel(supabase);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">과목반 세팅</h1>
        <GuideButton title="과목반 세팅 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">과목마다 담당 교사와 수강 학생 명단을 지정합니다.</p>

      {/* 반/담임 배정 관리와 같은 학기 고르개(요청 ②). */}
      <TermSettingTabs terms={view.terms} currentTermId={view.currentTermId} selectedTermId={view.selectedTermId} />

      {view.isCurrent ? (
        <>
          {d.loadError && (
            <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
              자료를 읽지 못했습니다: {d.loadError}
            </p>
          )}
          <SubjectManageClient initialSubjects={d.initialSubjects} team={d.team} classes={d.classes} students={d.students} />
        </>
      ) : (
        <TermSnapshotSubjects snapshot={view.snapshot} termLabel={view.selectedLabel} />
      )}
    </div>
  );
}
