import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { WrComment, WrReport, WrStudent } from "@/lib/types";
import StudentProfileClient from "@/components/weeklyReport/StudentProfileClient";

export const dynamic = "force-dynamic";

export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [{ data: student }, { data: reports }, { data: comments }] = await Promise.all([
    supabase.from("wr_students").select("*").eq("id", id).maybeSingle(),
    supabase.from("wr_reports").select("*").eq("student_id", id).order("report_date", { ascending: false }),
    supabase.from("wr_comments").select("*").eq("student_id", id).order("created_at", { ascending: false }),
  ]);

  if (!student) notFound();

  // 관리자/행정직원(그리고 개발자)은 주간 학생 관찰기록을 읽기전용이 아니라 직접 수정·삭제까지
  // 할 수 있어야 합니다(요청) - 그 외(교사 등으로 이 화면에 들어온 경우)는 예전처럼 읽기전용입니다.
  const isWrManager = isDeveloperEmail(me.email) || me.position === "관리자" || me.position === "행정직원";
  const s = student as WrStudent;

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
