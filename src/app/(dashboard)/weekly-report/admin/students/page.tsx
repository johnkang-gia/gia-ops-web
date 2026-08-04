import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { WrStudent, WrStudentFieldDef } from "@/lib/types";
import StudentManageClient from "@/components/weeklyReport/admin/StudentManageClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🎓 학생 명부 관리란?",
    lines: [
      "재학생을 등록·수정·재학상태 관리합니다. 여기서 등록한 학생은 반 배정과 과목반 세팅에서 바로 선택할 수 있습니다.",
      "학년 → 반 → 이름(가나다) 순으로 기본 정렬되고, 칼럼 제목을 클릭하면 구글시트처럼 그 칼럼 기준으로 다시 정렬됩니다.",
      "기본 항목 외에 필요한 항목이 있으면 [+ 칼럼 추가]로 원하는 이름의 칼럼을 직접 만들어 쓸 수 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function StudentManagePage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isDeveloperEmail(me.email) && me.position !== "관리자") redirect("/weekly-report");

  const [{ data: studentsData }, { data: fieldDefsData }] = await Promise.all([
    supabase
      .from("wr_students")
      .select("*")
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("wr_student_field_defs").select("*").order("sort_order", { ascending: true }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">학생 명부 관리</h1>
        <GuideButton title="학생 명부 관리 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">학생을 등록하면 반 배정(반/담임 배정 관리)과 과목 배정(과목반 세팅)에서 바로 선택할 수 있습니다.</p>
      <StudentManageClient
        initialStudents={(studentsData as WrStudent[] | null) ?? []}
        initialFieldDefs={(fieldDefsData as WrStudentFieldDef[] | null) ?? []}
        currentUserEmail={me.email}
      />
    </div>
  );
}
