import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser, isStaffOrAboveUser } from "@/lib/roles";
import type { TeamMember, WrClass } from "@/lib/types";
import ClassManageClient from "@/components/weeklyReport/admin/ClassManageClient";
import ClassRosterBoard, { type BoardStudent } from "@/components/weeklyReport/admin/ClassRosterBoard";
import GuideButton from "@/components/common/GuideButton";
import TermSettingTabs from "@/components/school/TermSettingTabs";
import { TermSnapshotClasses } from "@/components/school/TermSnapshotView";
import { loadTermSettingView } from "@/lib/termSettingView";

const GUIDE_SECTIONS = [
  {
    title: "🏫 반/담임 배정 관리란?",
    lines: ["학년별 반을 만들고 담임/부담임 교사를 배정합니다. 배정하면 해당 교사의 \"내 담임반\" 화면에 자동으로 나타납니다."],
  },
];

export const dynamic = "force-dynamic";

export default async function ClassManagePage({
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

  const [{ data: classesData }, { data: teamData }, stuRes] = await Promise.all([
    supabase.from("wr_classes").select("*").eq("is_demo", false).order("grade", { ascending: true }).order("class_name", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    // 반 배정판에 세울 이름표. 반이 없는 아이도 함께 읽어야 '미배정' 칸이 채워집니다.
    supabase
      .from("wr_students_basic")
      .select("id, name, name_en, grade, class_name, class_id, gender")
      .eq("status", "active")
      .order("name"),
  ]);
  if (stuRes.error) console.error("[반 배정판] 명단을 읽지 못했습니다:", stuRes.error.message);

  const boardStudents = ((stuRes.data as { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null; class_id: string | null; gender: "남" | "여" | null }[] | null) ?? []).map<BoardStudent>(
    (s) => ({ id: s.id, name: s.name, nameEn: s.name_en, grade: s.grade, className: s.class_name, classId: s.class_id, gender: s.gender }),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">반/담임 배정 관리</h1>
        <GuideButton title="반/담임 배정 관리 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">교사의 담임반을 배정합니다. 여기서 배정하면 해당 교사의 &quot;내 담임반&quot; 화면에 자동으로 나타납니다.</p>

      {/* 학기 고르개(요청 ②). 진행중 학기는 지금 세팅을 고치고, 지난 학기는 그 학기가
          끝날 때 떠둔 기록을 읽기 전용으로 봅니다. */}
      <TermSettingTabs terms={view.terms} currentTermId={view.currentTermId} selectedTermId={view.selectedTermId} />

      {view.isCurrent ? (
        <>
          <ClassManageClient initialClasses={(classesData as WrClass[] | null) ?? []} team={(teamData as TeamMember[] | null) ?? []} />
          {/* 반 배정판.
              반을 고치려면 지금까지 명부 표에서 아이를 하나씩 찾아 반 칸을 고쳐야 했습니다.
              한 반을 통째로 다시 짤 때는 그 방식이 맞지 않습니다 - 누가 어느 반에 몇 명
              있는지가 안 보이니 옮기면서도 균형을 알 수 없습니다. */}
          <ClassRosterBoard
            classes={(classesData as WrClass[] | null) ?? []}
            initialStudents={boardStudents}
            canEdit={isStaffOrAboveUser(me)}
          />
        </>
      ) : (
        <TermSnapshotClasses snapshot={view.snapshot} termLabel={view.selectedLabel} />
      )}
    </div>
  );
}
