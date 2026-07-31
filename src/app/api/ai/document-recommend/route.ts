import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildDocumentRecommendSystemPrompt, buildDocumentRecommendEntryBlock } from "@/lib/ai/prompts";
import type { DocumentRecommendResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";
import { logApiError } from "@/lib/logging";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const { data: existing } = await supabase.from("documents").select("name");
    const existingNames = (existing ?? []).map((d) => d.name);

    const systemPrompt = buildDocumentRecommendSystemPrompt();
    const userPrompt = buildDocumentRecommendEntryBlock(existingNames);
    // 목록 추천은 이미 조사된 법령 목록을 바탕으로 한 분류 작업에 가까워 저렴한 모델로 충분합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      route: "document-recommend",
    })) as DocumentRecommendResult;

    const toInsert = (result.documents || []).filter(
      (d) => d.name && !existingNames.includes(d.name)
    );
    if (!toInsert.length) {
      return NextResponse.json({ success: true, created: 0 });
    }

    const { data, error } = await supabase
      .from("documents")
      .insert(
        toInsert.map((d) => ({
          case_id: genCaseId("DOC"),
          name: d.name,
          category: d.category || "",
          status: "필요",
          notes: d.reason || "",
        }))
      )
      .select();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, created: data?.length ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "document-recommend", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
