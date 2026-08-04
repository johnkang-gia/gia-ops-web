import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { WrClass, WrStudent } from "@/lib/types";
import StudentReportBoard from "@/components/weeklyReport/StudentReportBoard";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🏠 내 담임반이란?",
    lines: [
      "내가 담임 또는 부담임으로 배정된 반의 학생 명단이 자동으로 나타납니다.",
      "학생 카드를 눌러 학업/향상점/참여도/행동/사회성 등 주간 관찰기록을 작성·수정할 수 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function HomeroomPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const email = me.email;

  const [{ data: classesData }, term] = await Promise.all([
    supabase.from("wr_classes").select("*").or(`teacher_email.eq.${email},sub_teacher_email.eq.${email}`),
    getCurrentTerm(),
  ]);
  const classes = (classesData as WrClass[] | null) ?? [];

  const studentsByClass = await Promise.all(
    classes.map(async (c) => {
      const { data } = await supabase
        .from("wr_students")
        .select("*")
        .eq("grade", c.grade ?? "")
        .eq("class_name", c.class_name ?? "")
        .eq("status", "active")
        .order("name", { ascending: true });
      return { cls: c, students: (data as WrStudent[] | null) ?? [] };
    })
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">내 담임반</h1>
        <GuideButton title="내 담임반 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {term ? `현재 학기: ${term.year}년 ${term.term_type}` : "진행중인 학기가 없습니다. 관리자에게 학기 설정을 요청해주세요."}
      </p>

      {classes.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          배정된 담임반이 없습니다.
        </p>
      )}

      <div className="flex flex-col gap-6">
        {studentsByClass.map(({ cls, students }) => (
          <div key={cls.id}>
            <h2 className="mb-2 text-sm font-bold text-slate-600">
              {cls.grade}학년 {cls.class_name} ({students.length}명)
            </h2>
            <StudentReportBoard students={students} term={term} userEmail={email} mode="homeroom" subjectName="담임" />
          </div>
        ))}
      </div>
    </div>
  );
}
