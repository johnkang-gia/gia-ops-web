import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildManualDraftClassifySystemPrompt, buildManualDraftEntryBlock } from "@/lib/ai/prompts";
import { findLegalFullText } from "@/lib/ai/lawReference";
import type { ManualDraftClassifyResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rawText = String(body.rawText || "").trim();

  if (!rawText) {
    return NextResponse.json({ error: "작성하실 내용을 입력해주세요." }, { status: 400 });
  }

  try {
    // 어느 문서(학부모용/실무자용/둘다)에 반영할지는 사람이 미리 고르지 않고 AI가 아래에서
    // 판단합니다. 그래서 초안 생성 시점에는 target_doc을 비워두고, 판단 후에 채워 넣습니다.
    const { data: draft, error: draftErr } = await supabase
      .from("manual_drafts")
      .insert({ case_id: genCaseId("MDR"), raw_text: rawText })
      .select()
      .single();
    if (draftErr) throw new Error(draftErr.message);

    const systemPrompt = buildManualDraftClassifySystemPrompt();
    const userPrompt = buildManualDraftEntryBlock(rawText);
    const result = (await callClaudeJson(systemPrompt, userPrompt)) as ManualDraftClassifyResult;

    const legalSummary = findLegalFullText(result.legalBasis) || result.legalSummary || "";
    const targetDocs =
      result.targetDoc === "둘다" ? (["학부모용", "실무자용"] as const) : ([result.targetDoc || "실무자용"] as const);

    const proposals = [];
    for (const targetDoc of targetDocs) {
      const { data: proposal, error: insertErr } = await supabase
        .from("proposals")
        .insert({
          case_id: genCaseId("PRP"),
          source: "manual",
          source_id: draft.case_id,
          date: new Date().toISOString().slice(0, 10),
          target_doc: targetDoc,
          category: result.category || "미분류",
          final_text: result.finalText || rawText,
          legal_basis: result.legalBasis || "",
          applicability: result.legalApplicability || "",
          legal_summary: legalSummary,
          benchmark: result.benchmarkNote || "",
        })
        .select()
        .single();
      if (insertErr) throw new Error(insertErr.message);
      proposals.push(proposal);
    }

    await supabase
      .from("manual_drafts")
      .update({ target_doc: result.targetDoc, scanned_at: new Date().toISOString() })
      .eq("id", draft.id);

    return NextResponse.json({ success: true, proposals, reason: result.targetDocReason || "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
