import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { AppUser, Meeting, Task } from "@/lib/types";
import ReportsHubClient from "@/components/documents/ReportsHubClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📊 보고서 모음이란?",
    lines: [
      "업무 보고서와 회의 보고서를 탭 하나로 오가며 보는 화면입니다. 두 보고서를 각각 다른 메뉴에서 찾을 필요가 없습니다.",
      "여기 보이는 내용은 [업무 > 업무 보고서], [기록 > 회의 보고서]와 완전히 같은 화면입니다. 문서함 안에서도 같은 것을 볼 수 있게 탭으로 묶어둔 것뿐입니다.",
      "기간을 정해 PDF로 뽑을 수 있습니다. 이사회 보고나 학기 정리에 그대로 쓰시면 됩니다.",
    ],
  },
];

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
    <div className="flex flex-col">
      <div className="flex justify-end">
        <GuideButton title="보고서 모음 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <ReportsHubClient
      tasks={tasks}
      nameByEmail={Object.fromEntries(users.map((u) => [u.email, u.name || u.email]))}
      meetings={meetings}
      />
    </div>
  );
}
