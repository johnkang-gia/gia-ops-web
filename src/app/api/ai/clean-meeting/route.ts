import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildMeetingCleanupSystemPrompt, buildMeetingCleanupEntryBlock } from "@/lib/ai/prompts";
import type { MeetingCleanupResult } from "@/lib/ai/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const date = String(body.date || "");
  const attendees = String(body.attendees || "");
  const content = String(body.content || "").trim();

  if (!content) {
    return NextResponse.json({ error: "정리할 회의 내용이 없습니다." }, { status: 400 });
  }

  try {
    const systemPrompt = buildMeetingCleanupSystemPrompt();
    const userPrompt = buildMeetingCleanupEntryBlock({ date, attendees, content });
    // 맞춤법/문장 정리는 비교적 기계적인 작업이라 저렴한 모델(Haiku)로 충분합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 3000,
    })) as MeetingCleanupResult;

    return NextResponse.json({ success: true, cleanedContent: result.cleanedContent || content });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
