import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildManualFaqSystemPrompt, buildManualFaqEntryBlock } from "@/lib/ai/prompts";
import { htmlToPlainText } from "@/lib/manualHtml";
import type { ManualFaqResult } from "@/lib/ai/types";
import { logApiError } from "@/lib/logging";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const { data: sections, error } = await supabase
      .from("manual_sections")
      .select("category, content")
      .eq("target_doc", "학부모용")
      .order("category", { ascending: true });
    if (error) throw new Error(error.message);
    if (!sections || sections.length === 0) {
      return NextResponse.json(
        { error: "학부모용 운영계획안에 아직 내용이 없어 FAQ를 만들 수 없습니다." },
        { status: 400 }
      );
    }

    const systemPrompt = buildManualFaqSystemPrompt();
    const userPrompt = buildManualFaqEntryBlock(
      sections.map((s) => ({ category: s.category, content: htmlToPlainText(s.content) }))
    );
    // 이미 확정된 매뉴얼 내용을 재구성하는 작업이라 저렴한 모델로 충분합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 4000,
      route: "manual-faq",
    })) as ManualFaqResult;

    return NextResponse.json({ success: true, faqs: result.faqs || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "manual-faq", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
