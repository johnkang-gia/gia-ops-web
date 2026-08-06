import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import WorkBoardClient from "@/components/work/WorkBoardClient";
import type { Task, Department, TeamMember, TaskModeColor, GoogleChatMirrorMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

// WorkFlatform 참조의 ClientApp은 별도 설명 문구 없이 사이드바+워크스페이스가 화면 전체를
// 채우는 구조입니다 - 여기서도 상단 안내문 없이 WorkBoardClient가 가용 공간 전체를 차지하도록
// 구성했습니다(요청 #2: UI/UX 그대로 이식).
export default async function WorkPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [tasksRes, teamRes, deptRes, modeColorRes, mirrorRes] = await Promise.all([
    // deleted_at도 명시적으로 걸러야 합니다 - RLS는 등록자/담당자/관리자에게 휴지통 조회용으로
    // deleted_at is not null(7일 이내) 행도 select 허용하는 별도 정책이 OR로 붙어있어서, 여기서
    // 걸러주지 않으면 방금 삭제한 업무가 등록자/담당자 눈에는 업무보드에 계속 남아있게 됩니다
    // (요청: "업무를 삭제해도 계속 표시되").
    supabase.from("tasks").select("*").is("archived_at", null).is("deleted_at", null).order("position", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("departments").select("*").order("sort_order", { ascending: true }),
    supabase.from("task_mode_colors").select("*"),
    // 구글챗 미러링(출결알림/선생님요청) 최근 메시지입니다. 아직 SQL 마이그레이션을 실행하지
    // 않은 상태(테이블이 없는 상태)에서도 페이지가 죽지 않도록, supabase-js는 테이블이 없으면
    // 에러 없이 {data:null,error}를 돌려주는 특성을 이용해 아래에서 항상 ?? []로 방어합니다.
    supabase
      .from("google_chat_mirror_messages")
      .select("*")
      .order("created_at_google", { ascending: false })
      .limit(200),
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
        initialMirrorMessages={(mirrorRes.data as GoogleChatMirrorMessage[] | null) ?? []}
      />
    </div>
  );
}
