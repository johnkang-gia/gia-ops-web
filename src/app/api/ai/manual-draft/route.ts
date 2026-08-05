import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildManualDraftClassifySystemPrompt, buildManualDraftEntryBlock } from "@/lib/ai/prompts";
import { findLegalFullText } from "@/lib/ai/lawReference";
import type { ManualDraftClassifyResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";
import { logApiError } from "@/lib/logging";
import { loadPolicyCategoryNames } from "@/lib/policyCategories";

// 흔히 나오는 조사/접속사만 제외하는 아주 단순한 불용어 목록입니다. 정교한 형태소 분석기 없이,
// AI 호출 없는 "키워드 겹침" 방식으로 과거 관련 기록을 찾기 위한 최소한의 필터입니다(요청 6번,
// 과금 절감 요청과도 맞물림 - 비용 0).
const STOPWORDS = new Set([
  "그리고", "그런데", "하지만", "그래서", "이렇게", "저렇게", "때문에", "합니다", "했습니다",
  "있습니다", "없습니다", "대해서", "위해서", "통해서", "에서는", "에게는", "으로는", "입니다",
  "되었습니다", "한다고", "했다고", "그러나", "관련해서", "관련하여",
]);

function extractKeywords(text: string, max = 6): string[] {
  const tokens = text
    .split(/[\s,.!?~\-()【】\[\]:;"'‘’“”·/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  const unique = Array.from(new Set(tokens));
  // 너무 짧은 단어보다 구체적인(긴) 단어가 검색에 더 의미 있을 가능성이 높아 길이 내림차순 정렬.
  return unique.sort((a, b) => b.length - a.length).slice(0, max);
}

type RelatedRecord = { source: "incidents" | "meetings" | "manual_sections"; id: string; label: string; snippet: string };

// AI를 호출하지 않고, 원문에서 뽑은 키워드가 과거 사건/회의/이미 발행된 매뉴얼 항목의 텍스트에
// 겹치는지 단순 ILIKE 검색으로만 찾아 "관련 있어 보이는 과거 기록"으로 추천합니다(요청 6번).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findRelatedRecords(supabase: any, rawText: string): Promise<RelatedRecord[]> {
  const keywords = extractKeywords(rawText);
  if (!keywords.length) return [];

  const results: RelatedRecord[] = [];

  const incidentOr = keywords.map((k) => `title.ilike.%${k}%,detail.ilike.%${k}%`).join(",");
  const { data: incidents } = await supabase
    .from("incidents")
    .select("id, case_id, title, detail")
    .or(incidentOr)
    .order("date", { ascending: false })
    .limit(3);
  for (const row of incidents || []) {
    results.push({
      source: "incidents",
      id: row.case_id,
      label: row.title || "(제목 없음)",
      snippet: (row.detail || "").slice(0, 80),
    });
  }

  const meetingOr = keywords.map((k) => `content.ilike.%${k}%`).join(",");
  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, case_id, date, content")
    .or(meetingOr)
    .order("date", { ascending: false })
    .limit(3);
  for (const row of meetings || []) {
    results.push({
      source: "meetings",
      id: row.case_id,
      label: `${row.date} 회의`,
      snippet: (row.content || "").slice(0, 80),
    });
  }

  const manualOr = keywords.map((k) => `content.ilike.%${k}%,category.ilike.%${k}%`).join(",");
  const { data: sections } = await supabase
    .from("manual_sections")
    .select("id, target_doc, category, content")
    .or(manualOr)
    .limit(3);
  for (const row of sections || []) {
    results.push({
      source: "manual_sections",
      id: row.id,
      label: `[${row.target_doc}] ${row.category}`,
      snippet: (row.content || "").replace(/<[^>]+>/g, "").slice(0, 80),
    });
  }

  return results.slice(0, 6);
}

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

    const existingCategories = await loadPolicyCategoryNames(supabase);

    const systemPrompt = buildManualDraftClassifySystemPrompt();
    const userPrompt = buildManualDraftEntryBlock(rawText, existingCategories);
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      route: "manual-draft",
    })) as ManualDraftClassifyResult;

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
          domain: result.domain || null,
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

    const relatedRecords = await findRelatedRecords(supabase, rawText);

    return NextResponse.json({ success: true, proposals, reason: result.targetDocReason || "", relatedRecords });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "manual-draft", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
