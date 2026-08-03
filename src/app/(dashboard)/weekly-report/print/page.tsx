import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { Term, WrStudent } from "@/lib/types";
import PrintSelectorClient from "@/components/weeklyReport/PrintSelectorClient";

export const dynamic = "force-dynamic";

export default async function PrintPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [{ data }, { data: terms }] = await Promise.all([
    supabase
      .from("wr_students")
      .select("*")
      .eq("status", "active")
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("terms").select("*").order("year", { ascending: false }).order("start_date", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-bold">리포트 프린트</h1>
      <p className="mb-4 text-xs text-slate-500">
        학생을 선택하면 발행(published)된 최신 리포트를 인쇄용 PDF로 볼 수 있고, 학기를 함께 고르면 그
        학기 동안 발행된 모든 리포트를 모은 학기 종합 PDF도 만들 수 있습니다.
      </p>
      <PrintSelectorClient students={(data as WrStudent[] | null) ?? []} terms={(terms as Term[] | null) ?? []} />
    </div>
  );
}
