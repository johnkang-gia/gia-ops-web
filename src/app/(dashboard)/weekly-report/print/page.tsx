import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { WrStudent } from "@/lib/types";
import PrintSelectorClient from "@/components/weeklyReport/PrintSelectorClient";

export const dynamic = "force-dynamic";

export default async function PrintPage() {
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
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-bold">리포트 프린트</h1>
      <p className="mb-4 text-xs text-slate-500">
        학생을 선택하면 발행(published)된 최신 리포트를 학부모 배포용 PDF로 볼 수 있습니다.
      </p>
      <PrintSelectorClient students={(data as WrStudent[] | null) ?? []} />
    </div>
  );
}
