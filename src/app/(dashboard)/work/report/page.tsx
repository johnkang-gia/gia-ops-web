import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { AppUser, Task } from "@/lib/types";
import WorkReportClient from "@/components/work/WorkReportClient";

export const dynamic = "force-dynamic";

// 구두로만 지시하고 끝나던 업무를 "언제 처리됐고 어떻게 처리됐는지" 남는 문서로 만들어
// 달라는 요청으로 만든 화면입니다. 일간/주간/월간 단위로 그 기간에 완료된 업무와, 그 기간에
// 아직 진행 중이던 업무 현황을 한 장의 보고서로 모아 바로 인쇄(또는 PDF 저장)할 수 있습니다.
export default async function WorkReportPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [{ data: tasksData }, { data: usersData }] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, case_id, title, description, status, priority, department, owner_email, assignee_emails, due_at, completed_at, archived_at, created_at, updated_at"
      )
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(2000),
    supabase.from("app_users").select("email, name").eq("status", "approved"),
  ]);

  const tasks = (tasksData as Task[] | null) ?? [];
  const users = (usersData as Pick<AppUser, "email" | "name">[] | null) ?? [];

  return <WorkReportClient tasks={tasks} nameByEmail={Object.fromEntries(users.map((u) => [u.email, u.name || u.email]))} />;
}
