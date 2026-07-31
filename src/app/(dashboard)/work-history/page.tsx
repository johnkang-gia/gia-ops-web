import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkHistoryClient from "@/components/workhistory/WorkHistoryClient";
import type { Todo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WorkHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("todos")
    .select("*")
    .eq("user_email", user.email as string)
    .order("for_date", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-bold">업무 히스토리</h1>
      <p className="mb-4 text-xs text-slate-500">
        홈 화면에서 적었던 할 일들이 날짜별로 여기에 쌓입니다. 달력에서 날짜를 눌러 그 날 어떤
        업무를 기록했는지 확인해보세요.
      </p>
      <WorkHistoryClient initialItems={(data as Todo[] | null) ?? []} />
    </div>
  );
}
