import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildAdoptedReviewSystemPrompt, buildAdoptedReviewEntryBlock } from "@/lib/ai/prompts";
import type { AdoptedReviewResult } from "@/lib/ai/types";
import type { Adopted } from "@/lib/types";

// 매뉴얼에 정식으로 실리기 전 마지막 관문이라 고품질 모델(기본 Sonnet)을 사용합니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  try {
    const { data: row, error: fetchErr } = await supabase.from("adopted").select("*").eq("id", id).single();
    if (fetchErr || !row) {
      return NextResponse.json({ error: fetchErr?.message || "채택예정 항목을 찾을 수 없습니다." }, { status: 404 });
    }
    const adopted = row as Adopted;
    if (!adopted.specific_text?.trim()) {
      return NextResponse.json({ error: "구체화한 최종 내용이 비어있습니다." }, { status: 400 });
    }

    const nextRound = (adopted.review_count ?? 0) + 1;
    const systemPrompt = buildAdoptedReviewSystemPrompt();
    const userPrompt = buildAdoptedReviewEntryBlock({
      targetDoc: adopted.target_doc,
      category: adopted.category,
      specificText: adopted.specific_text,
      reviewRound: nextRound,
    });
    const result = (await callClaudeJson(systemPrompt, userPrompt, { maxTokens: 3000 })) as AdoptedReviewResult;
    const reviewResultToStore = { ...result, reviewedText: adopted.specific_text };

    const { data: updated, error: updateErr } = await supabase
      .from("adopted")
      .update({
        review_result: reviewResultToStore,
        review_count: nextRound,
        last_reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) throw new Error(updateErr.message);

    return NextResponse.json({ success: true, item: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
