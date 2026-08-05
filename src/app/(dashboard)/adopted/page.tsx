import { createClient } from "@/lib/supabase/server";
import type { Adopted, ProposalSourceContext } from "@/lib/types";
import AdoptedClient from "@/components/adopted/AdoptedClient";

export const dynamic = "force-dynamic";

// 제안함(ProposalsClient)과 같은 방식으로, 채택예정 카드에도 "이 항목이 어떤 사건/행사/회의/
// 초안에서 나온 건지" 개요를 보여줍니다(요청: "채택예정도 제안함처럼 깔끔하게"). adopted.source_id는
// 원본 기록의 case_id 그대로이므로 proposals/page.tsx와 동일한 방식으로 조회합니다. complaint(예상
// 문의)·system(GIA시스템)은 origin 개념이 다르거나 없어서 이 조회 대상에서 제외합니다.
export default async function AdoptedPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("adopted")
    .select("*")
    .eq("publish", false)
    .order("date", { ascending: false })
    .limit(200);

  const items = (data as Adopted[]) ?? [];

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

  return <AdoptedClient initialItems={items} sourceContext={sourceContext} />;
}
