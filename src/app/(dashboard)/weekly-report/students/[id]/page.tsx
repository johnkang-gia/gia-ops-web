import { redirect, notFound } from "next/navigation";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser, isTeacherOnly } from "@/lib/roles";
import type { WrClass, WrComment, WrReport, WrStudent, WrSubject } from "@/lib/types";
import StudentProfileClient from "@/components/weeklyReport/StudentProfileClient";

export const dynamic = "force-dynamic";

export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [{ data: student }, { data: reports }, { data: comments }] = await Promise.all([
    supabase.from("wr_students").select("*").eq("is_demo", isDemoAccount(me.email)).eq("id", id).maybeSingle(),
    supabase.from("wr_reports").select("*").eq("student_id", id).order("report_date", { ascending: false }),
    supabase.from("wr_comments").select("*").eq("student_id", id).order("created_at", { ascending: false }),
  ]);

  if (!student) notFound();
  const s = student as WrStudent;

  // 교사는 부모 연락처를 포함한 학생 전체 기록을 볼 수 있는 화면이라, 자기 담임반이나 자기
  // 담당과목에 속한 학생일 때만 들어올 수 있게 막습니다(그 외 반은 검색으로도 우회 못하게
  // /api/search에서도 동일 기준으로 걸러줍니다) - 이전에는 로그인만 하면 어떤 학생이든 URL로
  // 바로 열람할 수 있었습니다.
  if (isTeacherOnly(me)) {
    const [{ data: ownClasses }, { data: ownSubjects }] = await Promise.all([
      s.class_id
        ? supabase
            .from("wr_classes")
            .select("id").eq("is_demo", isDemoAccount(me.email))
            .eq("id", s.class_id)
            .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
        : Promise.resolve({ data: [] as WrClass[] }),
      supabase.from("wr_subjects").select("id, student_ids").eq("teacher_email", me.email),
    ]);
    const ownsViaClass = (ownClasses?.length ?? 0) > 0;
    const ownsViaSubject = ((ownSubjects as WrSubject[] | null) ?? []).some((sub) => sub.student_ids?.includes(id));
    if (!ownsViaClass && !ownsViaSubject) notFound();
  }

  // 관리자/행정직원(그리고 개발자)은 주간 학생 관찰기록을 읽기전용이 아니라 직접 수정·삭제까지
  // 할 수 있어야 합니다(요청) - 그 외(교사 등으로 이 화면에 들어온 경우)는 예전처럼 읽기전용입니다.
  const isWrManager = isStaffOrAboveUser(me);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">
        {s.name}
        {s.name_en && <span className="ml-1.5 text-base font-normal text-slate-400">({s.name_en})</span>} 학생
      </h1>
      <p className="mb-4 text-xs text-slate-500">
        {s.grade}학년 {s.class_name} · 보호자 연락처 {s.parent_phone ?? "-"}
      </p>
      <StudentProfileClient
        student={s}
        reports={(reports as WrReport[] | null) ?? []}
        initialComments={(comments as WrComment[] | null) ?? []}
        userEmail={me.email}
        isWrManager={isWrManager}
      />
    </div>
  );
}
