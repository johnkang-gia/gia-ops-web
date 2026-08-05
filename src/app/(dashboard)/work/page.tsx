import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import WorkBoardClient from "@/components/work/WorkBoardClient";
import type { Task, Department, TeamMember, TaskModeColor, StaffRequestCategoryRow } from "@/lib/types";

export const dynamic = "force-dynamic";

// WorkFlatform 참조의 ClientApp은 별도 설명 문구 없이 사이드바+워크스페이스가 화면 전체를
// 채우는 구조입니다 - 여기서도 상단 안내문 없이 WorkBoardClient가 가용 공간 전체를 차지하도록
// 구성했습니다(요청 #2: UI/UX 그대로 이식).
export default async function WorkPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [tasksRes, teamRes, deptRes, modeColorRes, pendingRequestsRes, requestCategoriesRes] = await Promise.all([
    supabase.from("tasks").select("*").is("archived_at", null).order("position", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("departments").select("*").order("sort_order", { ascending: true }),
    supabase.from("task_mode_colors").select("*"),
    // 행정요청 메뉴가 이제 여기(관리자/행정직원)에는 따로 없으므로(요청: "행정요청메뉴는 교사에게만
    // 보이고, 나머지에게는 업무에 등록되는 것으로 알수있게 해줘"), 업무상황판 오른쪽에 보여줄
    // 미처리(완료 제외) 건수를 함께 가져옵니다.
    supabase.from("staff_requests").select("id", { count: "exact", head: true }).neq("status", "완료"),
    supabase.from("staff_request_categories").select("*").order("sort_order", { ascending: true }),
  ]);

  const team = (teamRes.data as TeamMember[] | null) ?? [];
  const isAdmin = isAdminUser(me);

  return (
    <div className="h-full">
      <WorkBoardClient
        initialTasks={(tasksRes.data as Task[] | null) ?? []}
        team={team}
        userEmail={me.email}
        departments={(deptRes.data as Department[] | null) ?? []}
        isAdmin={isAdmin}
        initialModeColors={(modeColorRes.data as TaskModeColor[] | null) ?? []}
        pendingRequestCount={pendingRequestsRes.count ?? 0}
        initialRequestCategories={(requestCategoriesRes.data as StaffRequestCategoryRow[] | null) ?? []}
      />
    </div>
  );
}
