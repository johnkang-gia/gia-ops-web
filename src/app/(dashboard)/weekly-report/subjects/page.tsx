import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { WrSubject, WrStudent } from "@/lib/types";
import StudentReportBoard from "@/components/weeklyReport/StudentReportBoard";

export const dynamic = "force-dynamic";

export default async function MySubjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const email = (user.email ?? "").toLowerCase();

  const [{ data: subjectsData }, term] = await Promise.all([
    supabase.from("wr_subjects").select("*").eq("teacher_email", email).order("name", { ascending: true }),
    getCurrentTerm(supabase),
  ]);
  const subjects = (subjectsData as WrSubject[] | null) ?? [];

  const studentsBySubject = await Promise.all(
    subjects.map(async (s) => {
      if (s.student_ids.length === 0) return { subject: s, students: [] as WrStudent[] };
      const { data } = await supabase
        .from("wr_students")
        .select("*")
        .in("id", s.student_ids)
        .eq("status", "active")
        .order("name", { ascending: true });
      return { subject: s, students: (data as WrStudent[] | null) ?? [] };
    })
  );

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-bold">내 담당과목</h1>
      <p className="mb-4 text-xs text-slate-500">
        {term ? `현재 학기: ${term.year}년 ${term.term_type}` : "진행중인 학기가 없습니다. 관리자에게 학기 설정을 요청해주세요."}
      </p>

      {subjects.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          배정된 담당과목이 없습니다.
        </p>
      )}

      <div className="flex flex-col gap-6">
        {studentsBySubject.map(({ subject, students }) => (
          <div key={subject.id}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-600">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: subject.color ?? "#3B82F6" }} />
              {subject.name} ({students.length}명)
            </h2>
            <StudentReportBoard students={students} term={term} userEmail={email} mode="subject" subjectName={subject.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
