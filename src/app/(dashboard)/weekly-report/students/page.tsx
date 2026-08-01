import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { WrStudent } from "@/lib/types";
import StudentsListClient from "@/components/weeklyReport/StudentsListClient";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("wr_students")
    .select("*")
    .eq("status", "active")
    .order("grade", { ascending: true })
    .order("class_name", { ascending: true })
    .order("name", { ascending: true });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-lg font-bold">전교생 현황</h1>
      <p className="mb-4 text-xs text-slate-500">학생을 클릭하면 주간 리포트 이력을 볼 수 있습니다.</p>
      <StudentsListClient students={(data as WrStudent[] | null) ?? []} />
    </div>
  );
}
