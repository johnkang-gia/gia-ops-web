import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { WrSubject, WrStudent } from "@/lib/types";
import StudentReportBoard from "@/components/weeklyReport/StudentReportBoard";
import GuideButton from "@/components/common/GuideButton";
import { getT } from "@/lib/langServer";
import type { T } from "@/lib/lang";

function guideSections(t: T) {
  return [
    {
      title: t("📘 내 담당과목이란?", "📘 What is this page?"),
      lines: [
        t(
          "내가 담당 교사로 지정된 과목의 수강 학생 명단이 자동으로 나타납니다.",
          "Subjects you are assigned to teach appear here, together with the students enrolled in them."
        ),
        t(
          "학생 카드를 눌러 학업/향상점/참여도/행동/사회성 등 주간 관찰기록을 작성·수정할 수 있습니다.",
          "Tap a student card to write or edit this week's observation record."
        ),
      ],
    },
  ];
}

export const dynamic = "force-dynamic";

export default async function MySubjectsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const email = me.email;
  const t = await getT();

  const [{ data: subjectsData }, term] = await Promise.all([
    supabase.from("wr_subjects").select("*").eq("teacher_email", email).order("name", { ascending: true }),
    getCurrentTerm(),
  ]);
  const subjects = (subjectsData as WrSubject[] | null) ?? [];

  const studentsBySubject = await Promise.all(
    subjects.map(async (s) => {
      if (s.student_ids.length === 0) return { subject: s, students: [] as WrStudent[] };
      const { data } = await supabase
        .from("wr_students_basic")
        .select("*")
        .in("id", s.student_ids)
        .eq("status", "active")
        .order("name", { ascending: true });
      return { subject: s, students: (data as WrStudent[] | null) ?? [] };
    })
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{t("내 담당과목", "My Subjects")}</h1>
        <GuideButton title={t("내 담당과목 사용 가이드", "My Subjects guide")} sections={guideSections(t)} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {term
          ? `${t("현재 학기", "Current term")}: ${term.year} ${term.term_type}`
          : t(
              "진행중인 학기가 없습니다. 관리자에게 학기 설정을 요청해주세요.",
              "No term is in progress. Please ask an administrator to set one up."
            )}
      </p>

      {subjects.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          {t("배정된 담당과목이 없습니다.", "No subject is assigned to you.")}
        </p>
      )}

      <div className="flex flex-col gap-6">
        {studentsBySubject.map(({ subject, students }) => (
          <div key={subject.id}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-600">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: subject.color ?? "#3B82F6" }} />
              {subject.name} ({t(`${students.length}명`, `${students.length} students`)})
            </h2>
            <StudentReportBoard students={students} term={term} userEmail={email} mode="subject" subjectName={subject.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
