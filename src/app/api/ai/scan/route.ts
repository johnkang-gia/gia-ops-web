import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import {
  buildIncidentClassifySystemPrompt,
  buildIncidentEntryBlock,
  buildMeetingClassifySystemPrompt,
  buildMeetingEntryBlock,
} from "@/lib/ai/prompts";
import { findLegalFullText } from "@/lib/ai/lawReference";
import type { IncidentClassifyResult, MeetingClassifyResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";

const BATCH_SIZE = 5;

type ScanType = "incidents" | "events" | "meetings";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const type = body.type as ScanType;
  if (!["incidents", "events", "meetings"].includes(type)) {
    return NextResponse.json({ error: "type은 incidents/events/meetings 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    if (type === "meetings") {
      const created = await scanMeetings(supabase);
      return NextResponse.json({ success: true, created });
    }
    const created = await scanIncidentOrEvent(supabase, type);
    return NextResponse.json({ success: true, created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanIncidentOrEvent(supabase: any, type: "incidents" | "events") {
  const { data: rows, error } = await supabase
    .from(type)
    .select("*")
    .is("scanned_at", null)
    .order("date", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(error.message);
  if (!rows || !rows.length) return 0;

  const label = type === "incidents" ? "사건" : "행사";
  let created = 0;

  for (const row of rows) {
    const entry = {
      type: label,
      title: row.title || row.name || "",
      detail: row.detail || "",
      good: row.good || "",
      lack: row.lack || "",
      suggest: row.suggest || "",
      owner: row.owner || "",
      suggestedCat: row.manual_cat || "",
    };
    const systemPrompt = buildIncidentClassifySystemPrompt();
    const userPrompt = buildIncidentEntryBlock(entry, "신규 기록");
    const result = (await callClaudeJson(systemPrompt, userPrompt)) as IncidentClassifyResult;

    const legalSummary = findLegalFullText(result.legalBasis);

    const { error: insertErr } = await supabase.from("proposals").insert({
      case_id: genCaseId("PRP"),
      source: type,
      source_id: row.case_id,
      date: row.date,
      target_doc: result.targetDoc || "실무자용",
      category: result.category || "미분류",
      remediation: (result.remediationOptions || []).join("\n\n[--- 다음 옵션 ---]\n\n"),
      parent_msg: (result.parentCommunicationOptions || []).join("\n\n[--- 다음 옵션 ---]\n\n"),
      student_edu: (result.studentEducationOptions || []).join("\n\n[--- 다음 옵션 ---]\n\n"),
      final_text: result.suggestedFinal || (result.remediationOptions || [])[0] || "",
      legal_basis: result.legalBasis || "",
      applicability: result.legalApplicability || "",
      legal_summary: legalSummary,
      benchmark: result.benchmarkNote || "",
    });
    if (insertErr) throw new Error(insertErr.message);

    await supabase.from(type).update({ scanned_at: new Date().toISOString() }).eq("id", row.id);
    created += 1;
  }

  return created;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanMeetings(supabase: any) {
  const { data: rows, error } = await supabase
    .from("meetings")
    .select("*")
    .is("scanned_at", null)
    .order("date", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(error.message);
  if (!rows || !rows.length) return 0;

  let created = 0;

  for (const row of rows) {
    const systemPrompt = buildMeetingClassifySystemPrompt();
    const userPrompt = buildMeetingEntryBlock(
      { date: row.date, attendees: row.attendees || "", content: row.content },
      "회의 정보"
    );
    const result = (await callClaudeJson(systemPrompt, userPrompt)) as MeetingClassifyResult;

    const proposals = result.proposals || [];
    const futurePlanItems: string[] = [];

    for (const p of proposals) {
      if (p.targetDoc === "향후계획") {
        futurePlanItems.push(p.finalText);
        continue;
      }
      const { error: insertErr } = await supabase.from("proposals").insert({
        case_id: genCaseId("PRP"),
        source: "meetings",
        source_id: row.case_id,
        date: row.date,
        target_doc: p.targetDoc,
        category: p.category || "미분류",
        final_text: p.finalText,
      });
      if (insertErr) throw new Error(insertErr.message);
      created += 1;
    }

    const nextAgendaText = (result.nextAgendaItems || []).join("\n");
    const futurePlanText = futurePlanItems.join("\n");

    await supabase
      .from("meetings")
      .update({
        scanned_at: new Date().toISOString(),
        next_agenda: [row.next_agenda, nextAgendaText].filter(Boolean).join("\n") || null,
        final_record: [row.final_record, futurePlanText].filter(Boolean).join("\n") || null,
      })
      .eq("id", row.id);
  }

  return created;
}
