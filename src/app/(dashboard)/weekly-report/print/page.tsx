import { redirect } from "next/navigation";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { Term, WrStudent } from "@/lib/types";
import PrintSelectorClient from "@/components/weeklyReport/PrintSelectorClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🖨️ 리포트 프린트란?",
    lines: [
      "학생을 선택하면 발행(published)된 최신 주간 관찰기록을 인쇄용 PDF로 볼 수 있습니다.",
      "학기를 함께 고르면 그 학기 동안 발행된 모든 리포트를 모은 학기 종합 PDF도 만들 수 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// 전교생 명단에서 아무 학생이나 골라 리포트를 출력할 수 있는 화면이라 행정직원 이상만 볼 수
// 있어야 합니다(교사가 다른 반 학생 리포트를 출력할 수 있으면 안 됨) - /weekly-report/students와
// 동일한 이유로 여기서도 한 번 더 막습니다.
export default async function PrintPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/weekly-report/homeroom");

  const [{ data }, { data: terms }] = await Promise.all([
    supabase
      .from("wr_students")
      .select("*").eq("is_demo", isDemoAccount(me.email))
      .eq("status", "active")
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("terms").select("*").order("year", { ascending: false }).order("start_date", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">리포트 프린트</h1>
        <GuideButton title="리포트 프린트 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        학생을 선택하면 발행(published)된 최신 리포트를 인쇄용 PDF로 볼 수 있고, 학기를 함께 고르면 그
        학기 동안 발행된 모든 리포트를 모은 학기 종합 PDF도 만들 수 있습니다.
      </p>
      <PrintSelectorClient students={(data as WrStudent[] | null) ?? []} terms={(terms as Term[] | null) ?? []} />
    </div>
  );
}
