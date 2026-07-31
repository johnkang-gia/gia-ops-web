import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildMeetingChatSystemPrompt, buildMeetingChatEntryBlock } from "@/lib/ai/prompts";
import type { MeetingChatResult } from "@/lib/ai/types";

type ChatTurn = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const turns = Array.isArray(body.turns) ? (body.turns as ChatTurn[]) : [];
  const currentDraft = {
    date: String(body.currentDraft?.date || ""),
    attendees: String(body.currentDraft?.attendees || ""),
    organizedContent: String(body.currentDraft?.organizedContent || ""),
  };

  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return NextResponse.json({ error: "담당자 메시지가 필요합니다." }, { status: 400 });
  }

  try {
    const systemPrompt = buildMeetingChatSystemPrompt();
    const userPrompt = buildMeetingChatEntryBlock(turns, currentDraft);
    // 회의 메모를 정리/질문하는 비교적 기계적인 작업이라 저렴한 모델(Haiku)을 씁니다. 채팅
    // 특성상 여러 번 호출되므로 비용 통제가 특히 중요합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 3000,
    })) as MeetingChatResult;

    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
