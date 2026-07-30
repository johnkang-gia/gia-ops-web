import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildTermCompareSystemPrompt, buildTermCompareEntryBlock } from "@/lib/ai/prompts";
import type { EventCompareResult } from "@/lib/ai/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const termType = String(body.termType || "").trim();
  if (!termType) return NextResponse.json({ error: "termType이 필요합니다." }, { status: 400 });

  try {
    const { data: rows, error } = await supabase
      .from("terms")
      .select("year, good, lack, suggest")
      .eq("term_type", termType)
      .order("year", { ascending: true });
    if (error) throw new Error(error.message);
    if (!rows || rows.length < 2) {
      return NextResponse.json({ error: "비교할 이전 회차 기록이 2건 이상 있어야 합니다." }, { status: 400 });
    }

    const systemPrompt = buildTermCompareSystemPrompt();
    const userPrompt = buildTermCompareEntryBlock(
      rows.map((r) => ({ year: r.year, good: r.good || "", lack: r.lack || "", suggest: r.suggest || "" }))
    );
    // 내부 분석/요약용이라 저렴한 모델로 충분합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      model: CLAUDE_MODEL_FAST,
    })) as EventCompareResult;

    return NextResponse.json({ success: true, result, recordCount: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
