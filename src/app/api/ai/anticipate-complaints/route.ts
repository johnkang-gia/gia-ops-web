import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildComplaintAnticipateSystemPrompt, buildComplaintAnticipateEntryBlock } from "@/lib/ai/prompts";
import { findLegalFullText } from "@/lib/ai/lawReference";
import type { ComplaintAnticipateResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const hint = String(body.hint || "");

  try {
    const [{ data: existingSections }, { data: pendingProposals }] = await Promise.all([
      supabase.from("manual_sections").select("category").eq("target_doc", "실무자용"),
      supabase.from("proposals").select("category").eq("source", "complaint").eq("status", "검토대기"),
    ]);
    const existingCategories = [
      ...new Set([
        ...((existingSections ?? []).map((s) => s.category)),
        ...((pendingProposals ?? []).map((p) => p.category)),
      ]),
    ];

    const systemPrompt = buildComplaintAnticipateSystemPrompt();
    const userPrompt = buildComplaintAnticipateEntryBlock(existingCategories, hint);
    // 학부모 응대에 바로 쓰이는 문구라 고품질 모델을 사용합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      maxTokens: 6000,
    })) as ComplaintAnticipateResult;

    const toInsert = (result.complaints || []).filter(
      (c) => c.category && !existingCategories.includes(c.category)
    );
    if (!toInsert.length) {
      return NextResponse.json({ success: true, created: 0 });
    }

    const rows = toInsert.map((c) => ({
      case_id: genCaseId("PRP"),
      source: "complaint",
      date: new Date().toISOString().slice(0, 10),
      target_doc: "실무자용",
      category: c.category,
      final_text: `[예상 문의/컴플레인]\n${c.complaintSummary}\n\n[권장 응대]\n${c.recommendedResponse}`,
      legal_basis: c.legalBasis || "",
      legal_summary: findLegalFullText(c.legalBasis),
    }));

    const { data, error } = await supabase.from("proposals").insert(rows).select();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, created: data?.length ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
