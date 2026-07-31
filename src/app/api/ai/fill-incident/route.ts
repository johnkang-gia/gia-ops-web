import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildIncidentFillSystemPrompt, buildIncidentFillEntryBlock } from "@/lib/ai/prompts";
import type { IncidentFillResult } from "@/lib/ai/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const detail = String(body.detail || "").trim();
  const currentTitle = String(body.currentTitle || "").trim();

  if (!detail) {
    return NextResponse.json({ error: "채울 상세 내용이 없습니다." }, { status: 400 });
  }

  try {
    const todayDate = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildIncidentFillSystemPrompt();
    const userPrompt = buildIncidentFillEntryBlock(detail, todayDate, currentTitle);
    // 자유 텍스트에서 필드를 나눠 담는 비교적 기계적인 작업이라 저렴한 모델(Haiku)로 처리합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 1500,
    })) as IncidentFillResult;

    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
