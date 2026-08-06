import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson } from "@/lib/ai/claude";
import { buildQuickDocumentDraftSystemPrompt, buildQuickDocumentDraftEntryBlock } from "@/lib/ai/prompts";
import type { QuickDocumentDraftResult } from "@/lib/ai/types";
import { logApiError } from "@/lib/logging";

// "학교 문서함 > AI 서류 작성" - 서류함(documents)에 아직 행이 없는 상태에서, 담당자가 상황을
// 자유 문장으로 설명하면 AI가 문서명·초안·GIA시스템 분류를 한 번에 만들어 돌려줍니다. 이 라우트는
// documents에 아무것도 저장하지 않습니다(사용자가 결과를 검토/수정한 뒤 "서류함에 저장"을 눌러야
// AiDocumentDraftClient.tsx가 client-side로 insert합니다) - AI가 잘못 이해한 초안이 검토 없이
// 바로 서류함에 쌓이는 것을 막기 위함입니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const situation = String(body.situation || "").trim();
  if (!situation) return NextResponse.json({ error: "상황을 설명해주세요." }, { status: 400 });
  // 요청: "국제학교라 영어문서가 필요할 경우도 있어" - 잘못된 값이 오면 조용히 한국어로
  // 기본 처리합니다(알 수 없는 값 때문에 요청 자체가 실패하지 않도록).
  const rawLanguage = String(body.language || "ko");
  const language: "ko" | "en" | "bilingual" =
    rawLanguage === "en" || rawLanguage === "bilingual" ? rawLanguage : "ko";

  try {
    const { data: systemsData } = await supabase
      .from("gia_systems")
      .select("major, category, name")
      .order("major", { ascending: true })
      .order("category", { ascending: true })
      .order("name", { ascending: true });
    const giaSystems = (systemsData || []) as { major: string; category: string; name: string }[];

    const systemPrompt = buildQuickDocumentDraftSystemPrompt(language);
    const userPrompt = buildQuickDocumentDraftEntryBlock(situation, giaSystems);
    // 실제 서류 초안 작성은 정확도가 중요해 고품질 모델을 사용합니다.
    const result = (await callClaudeJson(systemPrompt, userPrompt, {
      maxTokens: 4000,
      route: "document-quick-draft",
    })) as QuickDocumentDraftResult;

    // matchedItemName이 GIA시스템 목록의 항목과 정확히 일치하면 그 항목의 id를 함께 돌려줘서,
    // 저장 시 gia_system_id로 연결할 수 있게 합니다(문자열은 지어낼 수 있어도 id는 DB에서
    // 직접 조회한 값만 쓰도록 서버에서 재검증).
    let giaSystemId: string | null = null;
    if (result.matchedItemName) {
      const { data: matched } = await supabase
        .from("gia_systems")
        .select("id")
        .eq("major", result.categoryMajor)
        .eq("category", result.category)
        .eq("name", result.matchedItemName)
        .maybeSingle();
      giaSystemId = matched?.id ?? null;
    }

    return NextResponse.json({
      suggestedName: result.suggestedName || "",
      categoryMajor: result.categoryMajor || "",
      category: result.category || "",
      giaSystemId,
      draftText: result.draftText || "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "document-quick-draft", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
