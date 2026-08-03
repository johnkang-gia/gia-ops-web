import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import WorkBoardClient from "@/components/work/WorkBoardClient";
import type { Task, Department, TeamMember, TaskModeColor } from "@/lib/types";

export const dynamic = "force-dynamic";

// WorkFlatform 참조의 ClientApp은 별도 설명 문구 없이 사이드바+워크스페이스가 화면 전체를
// 채우는 구조입니다 - 여기서도 상단 안내문 없이 WorkBoardClient가 가용 공간 전체를 차지하도록
// 구성했습니다(요청 #2: UI/UX 그대로 이식).
export default async function WorkPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [tasksRes, teamRes, deptRes, modeColorRes] = await Promise.all([
    supabase.from("tasks").select("*").is("archived_at", null).order("position", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("departments").select("*").order("sort_order", { ascending: true }),
    supabase.from("task_mode_colors").select("*"),
  ]);

  const team = (teamRes.data as TeamMember[] | null) ?? [];
  const isAdmin = isDeveloperEmail(me.email) || me.position === "관리자";

  return (
    <div className="h-full">
      <WorkBoardClient
        initialTasks={(tasksRes.data as Task[] | null) ?? []}
        team={team}
        userEmail={me.email}
        departments={(deptRes.data as Department[] | null) ?? []}
        isAdmin={isAdmin}
        initialModeColors={(modeColorRes.data as TaskModeColor[] | null) ?? []}
      />
    </div>
  );
}
