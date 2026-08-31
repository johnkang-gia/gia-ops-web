import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { TeamMember, WrClass } from "@/lib/types";
import ClassManageClient from "@/components/weeklyReport/admin/ClassManageClient";
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

  const [{ data: classesData }, { data: teamData }] = await Promise.all([
    supabase.from("wr_classes").select("*").order("grade", { ascending: true }).order("class_name", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
  ]);

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
        <ClassManageClient initialClasses={(classesData as WrClass[] | null) ?? []} team={(teamData as TeamMember[] | null) ?? []} />
      ) : (
        <TermSnapshotClasses snapshot={view.snapshot} termLabel={view.selectedLabel} />
      )}
    </div>
  );
}
