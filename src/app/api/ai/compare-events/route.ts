import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildEventCompareSystemPrompt, buildEventCompareEntryBlock } from "@/lib/ai/prompts";
import type { EventCompareResult } from "@/lib/ai/types";
import { logApiError } from "@/lib/logging";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name이 필요합니다." }, { status: 400 });

  try {
    const { data: rows, error } = await supabase
      .from("events")
      .select("date, good, lack, suggest")
      .ilike("name", name)
      .order("date", { ascending: true });
    if (error) throw new Error(error.message);
    if (!rows || rows.length < 2) {
      return NextResponse.json({ error: "비교할 이전 기록이 2건 이상 있어야 합니다." }, { status: 400 });
    }

    const systemPrompt = buildEventCompareSystemPrompt();
    const userPrompt = buildEventCompareEntryBlock(
      rows.map((r) => ({ date: r.date, good: r.good || "", lack: r.lack || "", suggest: r.suggest || "" }))
    );
    // 내부 분석/요약용이라 저렴한 모델로 충분합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      route: "compare-events",
    })) as EventCompareResult;

    return NextResponse.json({ success: true, result, recordCount: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "compare-events", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
