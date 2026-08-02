import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
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

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">{(student as WrStudent).name} 학생</h1>
      <p className="mb-4 text-xs text-slate-500">
        {(student as WrStudent).grade}학년 {(student as WrStudent).class_name} · 보호자 연락처{" "}
        {(student as WrStudent).parent_phone ?? "-"}
      </p>
      <StudentProfileClient
        student={student as WrStudent}
        reports={(reports as WrReport[] | null) ?? []}
        initialComments={(comments as WrComment[] | null) ?? []}
        userEmail={me.email}
      />
    </div>
  );
}
