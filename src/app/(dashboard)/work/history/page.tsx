import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import TaskHistoryClient from "@/components/work/TaskHistoryClient";
import type { Task, Term, TeamMember, Department } from "@/lib/types";

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
    <TaskHistoryClient
      tasks={(tasksRes.data as Task[] | null) ?? []}
      terms={(termsRes.data as Term[] | null) ?? []}
      team={(teamRes.data as TeamMember[] | null) ?? []}
      departments={(deptRes.data as Department[] | null) ?? []}
      currentUserEmail={me.email}
    />
  );
}
