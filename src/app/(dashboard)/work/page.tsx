import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkBoardClient from "@/components/work/WorkBoardClient";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WorkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [tasksRes, teamRes] = await Promise.all([
    supabase.from("tasks").select("*").order("position", { ascending: true }),
    supabase.from("app_users").select("email").eq("status", "approved").order("email", { ascending: true }),
  ]);

  const team = ((teamRes.data as { email: string }[] | null) ?? []).map((r) => r.email);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-lg font-bold">업무</h1>
      <p className="mb-4 text-xs text-slate-500">
        팀 전체가 함께 보는 업무 보드입니다. 카드를 등록하면 &quot;예정&quot;에 들어가고, 드래그해서
        진행중 · 완료 · 보류로 옮길 수 있어요. 카드를 누르면 담당자 지정과 실시간 코멘트를 남길 수
        있습니다.
      </p>
      <WorkBoardClient
        initialTasks={(tasksRes.data as Task[] | null) ?? []}
        team={team}
        userEmail={user.email ?? ""}
      />
    </div>
  );
}
