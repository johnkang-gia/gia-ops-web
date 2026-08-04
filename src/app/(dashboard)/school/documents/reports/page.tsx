import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { AppUser, Meeting, Task } from "@/lib/types";
import ReportsHubClient from "@/components/documents/ReportsHubClient";

export const dynamic = "force-dynamic";

// 학교 문서함 안에서 업무 보고서/회의 보고서를 탭 하나로 오가며 볼 수 있는 통합 화면입니다.
// 실제 데이터 조회·정렬·PDF 생성 로직은 각각 /work/report, /meetings/report 페이지와
// 동일한 컴포넌트(WorkReportClient/MeetingReportClient)를 그대로 재사용합니다 - 화면 두 개를
// 새로 만드는 대신, 문서함 안에서도 같은 화면을 탭으로 보여주는 방식입니다.
export default async function DocumentReportsHubPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const [{ data: tasksData }, { data: usersData }, { data: meetingsData }] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, case_id, title, description, status, priority, department, owner_email, assignee_emails, due_at, completed_at, archived_at, created_at, updated_at"
      )
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(2000),
    supabase.from("app_users").select("email, name").eq("status", "approved"),
    supabase
      .from("meetings")
      .select("id, case_id, date, attendees, content, status, next_agenda, final_record, created_at")
      .order("date", { ascending: false })
      .limit(1000),
  ]);

  const tasks = (tasksData as Task[] | null) ?? [];
  const users = (usersData as Pick<AppUser, "email" | "name">[] | null) ?? [];
  const meetings = (meetingsData as Meeting[] | null) ?? [];

  return (
    <ReportsHubClient
      tasks={tasks}
      nameByEmail={Object.fromEntries(users.map((u) => [u.email, u.name || u.email]))}
      meetings={meetings}
    />
  );
}
