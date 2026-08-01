import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkBoardClient from "@/components/work/WorkBoardClient";
import type { Task, Department } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WorkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [tasksRes, teamRes, deptRes] = await Promise.all([
    supabase.from("tasks").select("*").order("position", { ascending: true }),
    supabase.from("app_users").select("email").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("departments").select("*").order("sort_order", { ascending: true }),
  ]);

  const team = ((teamRes.data as { email: string }[] | null) ?? []).map((r) => r.email);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-lg font-bold">업무</h1>
      <p className="mb-4 text-xs text-slate-500">
        팀 전체가 함께 보는 업무 보드입니다. 카드를 등록하면 &quot;예정&quot;에 들어가고, 드래그해서
        진행중 · 완료 · 보류로 옮길 수 있어요. 부서를 선택하면 그 부서의 실시간 채팅도 함께
        볼 수 있고, 채팅에서 &quot;@사람&quot;을 태그하면 곧바로 업무 카드로 등록됩니다.
      </p>
      <WorkBoardClient
        initialTasks={(tasksRes.data as Task[] | null) ?? []}
        team={team}
        userEmail={user.email ?? ""}
        departments={(deptRes.data as Department[] | null) ?? []}
      />
    </div>
  );
}
