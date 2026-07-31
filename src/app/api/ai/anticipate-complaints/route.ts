import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildComplaintAnticipateSystemPrompt, buildComplaintAnticipateEntryBlock } from "@/lib/ai/prompts";
import { findLegalFullText } from "@/lib/ai/lawReference";
import { htmlToPlainText } from "@/lib/manualHtml";
import type { ComplaintAnticipateResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";

// AI 프롬프트에 실어보낼 기존 매뉴얼 내용의 항목당 최대 길이(비용 통제용 - 전체 내용을 다 보낼
// 필요 없이 "이미 이 주제가 다뤄졌는지" 판단할 정도면 충분합니다).
const MAX_CONTENT_CHARS = 600;

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
      supabase.from("manual_sections").select("category, content").eq("target_doc", "실무자용"),
      supabase
        .from("proposals")
        .select("category, final_text")
        .eq("source", "complaint")
        .eq("status", "검토대기"),
    ]);

    // 카테고리명이 달라도 내용이 겹칠 수 있으므로, AI가 실제 내용을 보고 중복을 판단할 수 있도록
    // 본문(요약)까지 함께 넘깁니다. 카테고리명만으로도 걸러지는 명백한 중복은 아래에서 한 번 더
    // 안전망으로 확인합니다.
    const existingManualEntries = (existingSections ?? []).map((s) => ({
      category: s.category,
      content: htmlToPlainText(s.content || "").slice(0, MAX_CONTENT_CHARS),
    }));
    const pendingComplaints = (pendingProposals ?? []).map((p) => ({
      category: p.category,
      text: (p.final_text || "").slice(0, MAX_CONTENT_CHARS),
    }));
    const existingCategories = [
      ...new Set([
        ...existingManualEntries.map((s) => s.category),
        ...pendingComplaints.map((p) => p.category),
      ]),
    ];

    const systemPrompt = buildComplaintAnticipateSystemPrompt();
    const userPrompt = buildComplaintAnticipateEntryBlock(existingManualEntries, pendingComplaints, hint);
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
