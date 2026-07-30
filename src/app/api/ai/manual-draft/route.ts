import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildManualDraftClassifySystemPrompt, buildManualDraftEntryBlock } from "@/lib/ai/prompts";
import { findLegalFullText } from "@/lib/ai/lawReference";
import type { ManualDraftClassifyResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";

const ALLOWED_TARGET_DOCS = ["학부모용", "실무자용"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rawText = String(body.rawText || "").trim();
  const targetDoc = String(body.targetDoc || "");

  if (!rawText) {
    return NextResponse.json({ error: "작성하실 내용을 입력해주세요." }, { status: 400 });
  }
  if (!ALLOWED_TARGET_DOCS.includes(targetDoc)) {
    return NextResponse.json({ error: "target_doc은 학부모용/실무자용 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    const { data: draft, error: draftErr } = await supabase
      .from("manual_drafts")
      .insert({ case_id: genCaseId("MDR"), target_doc: targetDoc, raw_text: rawText })
      .select()
      .single();
    if (draftErr) throw new Error(draftErr.message);

    const systemPrompt = buildManualDraftClassifySystemPrompt(targetDoc);
    const userPrompt = buildManualDraftEntryBlock(rawText);
    const result = (await callClaudeJson(systemPrompt, userPrompt)) as ManualDraftClassifyResult;

    const legalSummary = findLegalFullText(result.legalBasis) || result.legalSummary || "";

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

    await supabase.from("manual_drafts").update({ scanned_at: new Date().toISOString() }).eq("id", draft.id);

    return NextResponse.json({ success: true, proposal });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
