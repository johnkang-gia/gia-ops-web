import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { WrStudent } from "@/lib/types";
import StudentSearchClient from "@/components/students/StudentSearchClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🔍 학생 정보 조회란?",
    lines: [
      "학교 전체 재학생을 이름/학번으로 검색해 인적사항·학적사항을 확인합니다.",
      "업무·사건기록·주간 학생 관찰기록 등 그 학생과 관련된 기록도 한 화면에서 함께 볼 수 있습니다.",
    ],
  },
  {
    title: "👀 접근 권한",
    lines: ["관리자·행정직원(+개발자)만 접근할 수 있습니다. 교사는 자신이 맡은 학생의 위클리 리포트만 볼 수 있습니다."],
  },
];

export const dynamic = "force-dynamic";

// 행정직원/관리자(+개발자)만 접근 가능합니다 - 교사는 자기 담당 학생의 위클리 리포트만 보고,
// 여기서는 학교 전체 학생의 사건기록·업무언급까지 한 번에 볼 수 있어 접근을 좁혀둡니다.
export default async function StudentsSearchPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  if (!isStaffOrAboveUser(me)) {
    redirect("/home");
  }

  const { data } = await supabase
    .from("wr_students")
    .select(
      "id, student_no, name, name_en, grade, class_name, class_id, birth_date, phone, parent_phone, parent_email, gender, allergies, address, note, custom_fields, status, created_at"
    )
    .eq("status", "active")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">학생 정보 조회</h1>
          <GuideButton title="학생 정보 조회 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-4 text-xs text-slate-500">
          업무 · 사건기록 · 주간 학생 관찰기록에서 같은 학생은 항상 같은 학번(고유번호)으로 관리됩니다.
          이름이나 학번으로 검색해 그 학생의 인적사항·학적사항·관련 기록을 한 화면에서 확인하세요.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <StudentSearchClient students={(data as WrStudent[] | null) ?? []} />
      </div>
    </div>
  );
}
