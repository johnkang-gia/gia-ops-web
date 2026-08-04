import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { WrStudent } from "@/lib/types";
import StudentManageClient from "@/components/weeklyReport/admin/StudentManageClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🎓 학생 명부 관리란?",
    lines: [
      "재학생을 등록·수정·재학상태 관리합니다. 여기서 등록한 학생은 반 배정과 과목반 세팅에서 바로 선택할 수 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function StudentManagePage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isDeveloperEmail(me.email) && me.position !== "관리자") redirect("/weekly-report");

  const { data } = await supabase
    .from("wr_students")
    .select("*")
    .order("grade", { ascending: true })
    .order("class_name", { ascending: true })
    .order("name", { ascending: true });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">학생 명부 관리</h1>
        <GuideButton title="학생 명부 관리 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">학생을 등록하면 반 배정(반/담임 배정 관리)과 과목 배정(과목반 세팅)에서 바로 선택할 수 있습니다.</p>
      <StudentManageClient initialStudents={(data as WrStudent[] | null) ?? []} />
    </div>
  );
}
