import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildDocumentDraftSystemPrompt, buildDocumentDraftEntryBlock } from "@/lib/ai/prompts";
import type { DocumentDraftResult } from "@/lib/ai/types";

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
    const { data: doc, error: fetchErr } = await supabase
      .from("documents")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchErr || !doc) throw new Error(fetchErr?.message || "서류를 찾을 수 없습니다.");

    const systemPrompt = buildDocumentDraftSystemPrompt();
    const userPrompt = buildDocumentDraftEntryBlock({
      name: doc.name,
      category: doc.category || "",
      notes: doc.notes || "",
    });
    // 실제 서류 초안 작성은 정확도가 중요해 고품질 모델을 사용합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, { maxTokens: 4000 })) as DocumentDraftResult;

    const { data: updated, error: updateErr } = await supabase
      .from("documents")
      .update({ ai_draft: result.draftText || "" })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) throw new Error(updateErr.message);

    return NextResponse.json({ success: true, document: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
