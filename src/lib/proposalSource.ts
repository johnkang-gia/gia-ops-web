import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposalSourceContext } from "@/lib/types";

/**
 * 제안·채택예정 카드에 «어느 사건·행사·회의·초안에서 나온 건지» 개요를 붙입니다.
 *
 * 제안함과 채택예정 두 화면이 같은 조회를 각자 적고 있었습니다. 원본 표가 늘거나 칸이 바뀌면 한쪽만 고쳐지고 다른 쪽
 * 카드는 개요가 빈 채로 남습니다 - 그래서 한 곳에 둡니다. `source_id` 는 원본 기록의 case_id 그대로입니다.
 * 예상 문의(complaint)·GIA시스템(system)은 원본 개념이 다르거나 없어서 조회하지 않습니다.
 */
export async function loadProposalSourceContext(
  supabase: SupabaseClient,
  items: readonly { source: string; source_id: string | null }[],
): Promise<Record<string, ProposalSourceContext>> {
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

  return sourceContext;
}
