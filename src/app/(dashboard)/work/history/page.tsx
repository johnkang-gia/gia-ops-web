import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import TaskHistoryClient from "@/components/work/TaskHistoryClient";
import type { Task, Term, TeamMember, Department } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";
import WorkTabs from "@/components/work/WorkTabs";

const GUIDE_SECTIONS = [
  {
    title: "🗃️ 지난 업무란?",
    lines: [
      "완료 처리된 업무가 연도·학기·날짜별로 자동 보관되는 곳입니다. 업무 보드를 깨끗하게 유지하면서도 \"그때 그 일 어떻게 처리했더라\"를 되짚어볼 수 있습니다.",
      "완료한 업무는 일정 기간이 지나면 보드에서 이곳으로 자동으로 옮겨집니다. 직접 옮기실 필요가 없습니다.",
      "학기·부서·담당자로 걸러서 볼 수 있습니다. 지난 학기 같은 시기에 무슨 일이 있었는지 확인할 때 유용합니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// 매일 밤 크론(/api/cron/archive-tasks)이 archived_at을 채운 업무만 여기서 보여줍니다 -
// 업무보드 칸반에서는 이미 빠진 업무들이라, "누가 언제 무슨 업무를 했는지" 흐름을 나중에
// 찾아보는 용도의 별도 화면입니다.
export default async function WorkHistoryPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const [tasksRes, termsRes, teamRes, deptRes] = await Promise.all([
    supabase.from("tasks").select("*").not("archived_at", "is", null).order("completed_at", { ascending: false }),
    supabase.from("terms").select("*"),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("departments").select("*").order("sort_order", { ascending: true }),
  ]);

  return (
    <div className="flex flex-col">
      <WorkTabs />
      <div className="flex justify-end">
        <GuideButton title="지난 업무 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <TaskHistoryClient
      tasks={(tasksRes.data as Task[] | null) ?? []}
      terms={(termsRes.data as Term[] | null) ?? []}
      team={(teamRes.data as TeamMember[] | null) ?? []}
      departments={(deptRes.data as Department[] | null) ?? []}
      currentUserEmail={me.email}
      />
    </div>
  );
}
