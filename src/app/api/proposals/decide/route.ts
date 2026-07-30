import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genCaseId } from "@/lib/caseId";
import type { Proposal } from "@/lib/types";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildComplaintFinalizeSystemPrompt, buildComplaintFinalizeEntryBlock } from "@/lib/ai/prompts";
import type { ComplaintFinalizeResult } from "@/lib/ai/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const decision = body.decision as "승인" | "보류" | "삭제";
  if (!id || !["승인", "보류", "삭제"].includes(decision)) {
    return NextResponse.json({ error: "id와 decision(승인/보류/삭제)이 필요합니다." }, { status: 400 });
  }

  const { data: proposal, error: fetchErr } = await supabase
    .from("proposals")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !proposal) {
    return NextResponse.json({ error: fetchErr?.message || "제안을 찾을 수 없습니다." }, { status: 404 });
  }
  const p = proposal as Proposal;

  if (decision === "승인") {
    const guideParts: string[] = [];
    if (p.remediation) guideParts.push(`[보완/재발방지 방안 옵션]\n${p.remediation}`);
    if (p.parent_msg) guideParts.push(`[학부모 안내 멘트 옵션]\n${p.parent_msg}`);
    if (p.student_edu) guideParts.push(`[학생 교육 방법 옵션]\n${p.student_edu}`);

    // 예상 문의/컴플레인 제안은 실무자들이 회의를 거쳐 GIA 실정에 맞게 고친 문구를 그대로
    // 옮기지 않고, AI가 한 번 더 다듬어 깔끔한 규정 문구로 정리한 뒤 채택예정에 올립니다
    // (실무자매뉴얼에 바로 실을 수 있는 수준으로 만들기 위함).
    let specificText = p.final_text;
    if (p.source === "complaint") {
      try {
        const systemPrompt = buildComplaintFinalizeSystemPrompt();
        const userPrompt = buildComplaintFinalizeEntryBlock({ category: p.category, draftText: p.final_text });
        const result = (await callClaudeJson(systemPrompt, userPrompt)) as ComplaintFinalizeResult;
        specificText = result.finalText || p.final_text;
      } catch {
        // AI 정리에 실패해도 승인 자체는 막지 않고, 실무자가 입력한 원문을 그대로 사용합니다.
        specificText = p.final_text;
      }
    }

    const { error: insertErr } = await supabase.from("adopted").insert({
      case_id: genCaseId("ADT"),
      source_id: p.case_id,
      source: p.source,
      date: new Date().toISOString().slice(0, 10),
      target_doc: p.target_doc,
      category: p.category,
      ai_original: p.final_text,
      specific_text: specificText,
      guide: guideParts.join("\n\n") || null,
      legal_basis: p.legal_basis,
      applicability: p.applicability,
      legal_summary: p.legal_summary,
      benchmark: p.benchmark,
    });
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const { error: updateErr } = await supabase
    .from("proposals")
    .update({ status: decision, reflected_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
