import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { WrStudent } from "@/lib/types";
import StudentManageClient from "@/components/weeklyReport/admin/StudentManageClient";

export const dynamic = "force-dynamic";

export default async function StudentManagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const email = (user.email ?? "").toLowerCase();
  if (!isDeveloperEmail(email)) {
    const { data: me } = await supabase.from("app_users").select("position").eq("email", email).maybeSingle();
    if (me?.position !== "관리자") redirect("/weekly-report");
  }

  const { data } = await supabase
    .from("wr_students")
    .select("*")
    .order("grade", { ascending: true })
    .order("class_name", { ascending: true })
    .order("name", { ascending: true });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-lg font-bold">학생 명부 관리</h1>
      <p className="mb-4 text-xs text-slate-500">학생을 등록하면 반 배정(반/담임 배정 관리)과 과목 배정(과목반 세팅)에서 바로 선택할 수 있습니다.</p>
      <StudentManageClient initialStudents={(data as WrStudent[] | null) ?? []} />
    </div>
  );
}
