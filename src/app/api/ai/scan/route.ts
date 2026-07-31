import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
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
  const id = typeof body.id === "string" ? body.id : undefined;
  if (!["incidents", "events", "meetings"].includes(type)) {
    return NextResponse.json({ error: "type은 incidents/events/meetings 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    if (type === "meetings") {
      const created = await scanMeetings(supabase, id);
      return NextResponse.json({ success: true, created });
    }
    const created = await scanIncidentOrEvent(supabase, type, id);
    return NextResponse.json({ success: true, created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanIncidentOrEvent(supabase: any, type: "incidents" | "events", id?: string) {
  let query = supabase.from(type).select("*");
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.is("scanned_at", null).order("date", { ascending: true }).limit(BATCH_SIZE);
  }
  const { data: rows, error } = await query;
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
    // targetDoc이 "둘다"면 학부모용/실무자용 각각 별도 제안으로 만듭니다(문자열 "둘다"를 그대로
    // target_doc에 저장하면 매뉴얼 화면의 학부모용/실무자용 탭 어디에도 매칭되지 않는 값이 됩니다).
    const targetDocs =
      result.targetDoc === "둘다" ? (["학부모용", "실무자용"] as const) : ([result.targetDoc || "실무자용"] as const);

    for (const targetDoc of targetDocs) {
      const { error: insertErr } = await supabase.from("proposals").insert({
        case_id: genCaseId("PRP"),
        source: type,
        source_id: row.case_id,
        date: row.date,
        target_doc: targetDoc,
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
    }

    await supabase.from(type).update({ scanned_at: new Date().toISOString() }).eq("id", row.id);
    created += 1;
  }

  return created;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanMeetings(supabase: any, id?: string) {
  let query = supabase.from("meetings").select("*");
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.is("scanned_at", null).order("date", { ascending: true }).limit(BATCH_SIZE);
  }
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  if (!rows || !rows.length) return 0;

  let created = 0;

  for (const row of rows) {
    const systemPrompt = buildMeetingClassifySystemPrompt();
    const userPrompt = buildMeetingEntryBlock(
      { date: row.date, attendees: row.attendees || "", content: row.content },
      "회의 정보"
    );
    // 이미 결정된 회의 내용을 문서별로 분류/정리하는 작업이라 저렴한 모델(Haiku)로 처리합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
    })) as MeetingClassifyResult;

    const proposals = result.proposals || [];
    const futurePlanItems: string[] = [];

    for (const p of proposals) {
      if (p.targetDoc === "향후계획") {
        futurePlanItems.push(`[향후계획] ${p.finalText}`);
        continue;
      }
      if (p.targetDoc === "행사학기참고") {
        // 매뉴얼(규정)이 아니라 특정 행사/학기에 대한 회고이므로, 이름이 비슷한 행사 기록이나
        // 진행 중인 학기 기록을 찾아 "개선 제안"란에 자동으로 붙여둡니다(다음번 같은 행사/학기 때
        // AI 비교 리포트에 바로 반영됨). 매칭되는 기록이 없으면 회의록 자체의 확정 기록에 메모로 남깁니다.
        let matched = false;
        const guess = (p.eventNameGuess || "").trim();
        const note = `[회의록 참고, ${row.date}] ${p.finalText}`;

        if (guess && p.referenceKind === "학기") {
          // 진행 중인 같은 학기/캠프를 우선 찾고, 없으면 가장 최근 회차에 붙입니다.
          const { data: matchedTerms } = await supabase
            .from("terms")
            .select("id, suggest, status")
            .ilike("term_type", guess)
            .order("year", { ascending: false });
          const target =
            (matchedTerms || []).find((t: { status: string }) => t.status === "진행중") ??
            (matchedTerms || [])[0];
          if (target) {
            const merged = [target.suggest, note].filter(Boolean).join("\n\n");
            await supabase.from("terms").update({ suggest: merged }).eq("id", target.id);
            matched = true;
          }
        } else if (guess) {
          const { data: matchedEvents } = await supabase
            .from("events")
            .select("id, suggest")
            .ilike("name", `%${guess}%`)
            .order("date", { ascending: false })
            .limit(1);
          const target = matchedEvents?.[0];
          if (target) {
            const merged = [target.suggest, note].filter(Boolean).join("\n\n");
            await supabase.from("events").update({ suggest: merged }).eq("id", target.id);
            matched = true;
          }
        }

        if (!matched) {
          futurePlanItems.push(`[행사/학기 메모]${guess ? ` (${guess})` : ""} ${p.finalText}`);
        }
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
