import { createClient } from "@/lib/supabase/server";
import type { Proposal, ProposalSourceContext } from "@/lib/types";
import ProposalsClient from "@/components/proposals/ProposalsClient";
import WorkTabs from "@/components/work/WorkTabs";

export const dynamic = "force-dynamic";

// 제안 카드에 "이 제안이 어떤 사건/행사/회의/초안에서 나온 건지" 개요를 보여주기 위해(요청 7번:
// "어떤 사건에 대한 건지 사건의 개요를 간략하게 넣어주고"), proposals.source_id(원본 기록의
// case_id)로 사건/행사/회의/AI매뉴얼초안 원본을 한 번에 조회해 맵으로 만듭니다. 예상 문의
// (complaint)·GIA시스템(system)은 origin 개념이 다르거나 없어서 이 조회 대상에서 제외합니다.
export default async function ProposalsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("proposals")
    .select("*")
    .eq("status", "검토대기")
    .order("date", { ascending: false })
    .limit(200);

  const items = (data as Proposal[]) ?? [];

  const idsByType: Record<"incidents" | "events" | "meetings" | "manual", string[]> = {
    incidents: [],
    events: [],
    meetings: [],
    manual: [],
  };
  for (const it of items) {
    if (it.source_id && it.source in idsByType) {
      idsByType[it.source as keyof typeof idsByType].push(it.source_id);
    }
  }

  const [{ data: incidentRows }, { data: eventRows }, { data: meetingRows }, { data: manualRows }] =
    await Promise.all([
      idsByType.incidents.length
        ? supabase.from("incidents").select("case_id, title, detail, date").in("case_id", idsByType.incidents)
        : Promise.resolve({ data: [] as { case_id: string; title: string; detail: string; date: string }[] }),
      idsByType.events.length
        ? supabase.from("events").select("case_id, name, good, date").in("case_id", idsByType.events)
        : Promise.resolve({ data: [] as { case_id: string; name: string; good: string; date: string }[] }),
      idsByType.meetings.length
        ? supabase.from("meetings").select("case_id, content, date").in("case_id", idsByType.meetings)
        : Promise.resolve({ data: [] as { case_id: string; content: string; date: string }[] }),
      idsByType.manual.length
        ? supabase.from("manual_drafts").select("case_id, raw_text, created_at").in("case_id", idsByType.manual)
        : Promise.resolve({ data: [] as { case_id: string; raw_text: string; created_at: string }[] }),
    ]);

  const sourceContext: Record<string, ProposalSourceContext> = {};
  for (const r of incidentRows || []) {
    sourceContext[`incidents:${r.case_id}`] = { title: r.title || "(제목 없음)", detail: r.detail || "", date: r.date };
  }
  for (const r of eventRows || []) {
    sourceContext[`events:${r.case_id}`] = { title: r.name || "(제목 없음)", detail: r.good || "", date: r.date };
  }
  for (const r of meetingRows || []) {
    sourceContext[`meetings:${r.case_id}`] = { title: "회의록", detail: r.content || "", date: r.date };
  }
  for (const r of manualRows || []) {
    sourceContext[`manual:${r.case_id}`] = {
      title: "AI매뉴얼 초안",
      detail: r.raw_text || "",
      date: (r.created_at || "").slice(0, 10),
    };
  }

  return (
    <div className="p-4 sm:p-6">
      <WorkTabs />
      <ProposalsClient initialItems={items} sourceContext={sourceContext} />
    </div>
  );
}
