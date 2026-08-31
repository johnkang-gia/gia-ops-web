import { NextResponse } from "next/server";
import { todayKst } from "@/lib/kst";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildTaskAnalyzeSystemPrompt, buildTaskAnalyzeEntryBlock } from "@/lib/ai/prompts";
import type { TaskAnalyzeResult } from "@/lib/ai/types";
import { logApiError } from "@/lib/logging";

// 채팅 메시지 한 건을 눌러 "업무로 등록"할 때 호출됩니다. 제목 정리/담당자 추정/마감일 추정은
// 비교적 기계적인 작업이라 저렴한 모델(Haiku)로 처리합니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const content = String(body.content || "").trim();
  const teamNames: string[] = Array.isArray(body.teamNames) ? body.teamNames.filter((n: unknown) => typeof n === "string") : [];

  if (!content) {
    return NextResponse.json({ error: "분석할 메시지 내용이 없습니다." }, { status: 400 });
  }

  try {
    const todayDate = todayKst();
    const systemPrompt = buildTaskAnalyzeSystemPrompt(teamNames);
    const userPrompt = buildTaskAnalyzeEntryBlock(content, todayDate);
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 500,
      route: "analyze-task",
    })) as TaskAnalyzeResult;

    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "analyze-task", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
