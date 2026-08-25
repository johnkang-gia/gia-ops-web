import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { Meeting } from "@/lib/types";
import MeetingReportClient from "@/components/meetings/MeetingReportClient";
import WorkTabs from "@/components/work/WorkTabs";

export const dynamic = "force-dynamic";

// 회의도 업무기록과 마찬가지로 "그때그때 구두로 공유되고 끝나는" 문제가 있어, 일간/주간/월간
// 단위로 그 기간에 있었던 회의를 모아 바로 인쇄(또는 PDF 저장)할 수 있는 보고서 화면입니다.
export default async function MeetingReportPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("meetings")
    .select("id, case_id, date, attendees, content, status, next_agenda, final_record, created_at")
    .order("date", { ascending: false })
    .limit(1000);

  return (
    <div className="p-4 sm:p-6">
      <WorkTabs />
      <MeetingReportClient meetings={(data as Meeting[] | null) ?? []} />
    </div>
  );
}
