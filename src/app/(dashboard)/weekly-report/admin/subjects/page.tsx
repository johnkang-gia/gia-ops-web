import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { TeamMember, WrClass, WrStudent, WrSubject } from "@/lib/types";
import SubjectManageClient from "@/components/weeklyReport/admin/SubjectManageClient";

export const dynamic = "force-dynamic";

export default async function SubjectManagePage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isDeveloperEmail(me.email) && me.position !== "관리자") redirect("/weekly-report");

  const [{ data: subjectsData }, { data: teamData }, { data: classesData }, { data: studentsData }] = await Promise.all([
    supabase.from("wr_subjects").select("*").order("name", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("wr_classes").select("*").order("grade", { ascending: true }),
    supabase.from("wr_students").select("*").eq("status", "active").order("grade", { ascending: true }).order("name", { ascending: true }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-lg font-bold">과목반 세팅</h1>
      <p className="mb-4 text-xs text-slate-500">과목마다 담당 교사와 수강 학생 명단을 지정합니다.</p>
      <SubjectManageClient
        initialSubjects={(subjectsData as WrSubject[] | null) ?? []}
        team={(teamData as TeamMember[] | null) ?? []}
        classes={(classesData as WrClass[] | null) ?? []}
        students={(studentsData as WrStudent[] | null) ?? []}
      />
    </div>
  );
}
