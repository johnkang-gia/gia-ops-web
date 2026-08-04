import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { callClaudeJsonWithWebSearch } from "@/lib/ai/claude";
import { logApiError } from "@/lib/logging";
import type { GiaSystem } from "@/lib/types";

const CATEGORIES = ["구비서류", "내규", "계약서", "학생관리", "교사관리", "교직원관리", "매뉴얼", "운영계획안"];

const SYSTEM_PROMPT = `당신은 한국의 소규모 국제학교(대안교육기관) GIA International School의 운영진을 위해
"다른 국제학교/공립학교는 갖췄는데 GIA는 아직 없거나 부족한 운영 시스템"을 조사하는 리서치 어시스턴트입니다.

web_search 도구로 국내외 국제학교/사립학교/공립학교의 학교 운영 시스템(행정 서류 체계, 내규/취업규칙,
계약서 관리, 학생관리시스템, 교사관리, 교직원관리, 매뉴얼/운영계획안 등) 사례를 찾아보고, GIA가 참고할
만한 구체적인 시스템을 제안하세요. 실제로 검색해서 확인한 사례만 근거로 삼고, 막연한 일반론은 피하세요.

아래는 GIA가 "이미 갖췄거나 이미 검토한" 항목 목록입니다 - 이미 있는 항목은 다시 제안하지 말고,
정말 GIA에 없는(또는 부족한) 것 위주로 3~6개만 제안하세요:
{{EXISTING}}

마지막 응답은 반드시 아래 스키마의 JSON 객체 "하나만" 출력하세요(다른 설명 문장 금지):
{
  "suggestions": [
    {
      "category": "구비서류" | "내규" | "계약서" | "학생관리" | "교사관리" | "교직원관리" | "매뉴얼" | "운영계획안" | "기타",
      "name": "시스템/제도 이름(간결하게)",
      "description": "무엇이고 왜 GIA에 필요한지 2~4문장(한국어)",
      "benchmark_school": "참고한 실제 사례(학교/기관명, 검색으로 확인된 경우만)"
    }
  ]
}`;

export async function POST() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 사용할 수 있습니다." }, { status: 403 });

  try {
    const { data: existingRows } = await supabase.from("gia_systems").select("category, name, status");
    const existingText =
      ((existingRows as { category: string; name: string; status: string }[] | null) ?? [])
        .map((r) => `- [${r.category}] ${r.name} (${r.status})`)
        .join("\n") || "(없음)";

    const systemPrompt = SYSTEM_PROMPT.replace("{{EXISTING}}", existingText);
    const result = (await callClaudeJsonWithWebSearch(
      systemPrompt,
      `카테고리 예시: ${CATEGORIES.join(", ")}. 위 기준으로 GIA에 부족한 시스템을 제안해주세요.`,
      { route: "gia-systems-suggest", maxTokens: 4000, maxSearches: 8 }
    )) as { suggestions?: { category: string; name: string; description: string; benchmark_school?: string }[] };

    const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    if (suggestions.length === 0) {
      return NextResponse.json({ success: true, rows: [] });
    }

    const payload = suggestions
      .filter((s) => s.name?.trim() && s.category?.trim())
      .map((s) => ({
        category: s.category.trim(),
        name: s.name.trim(),
        status: "미보유" as const,
        description: s.description?.trim() || null,
        benchmark_school: s.benchmark_school?.trim() || null,
        source: "ai_suggested" as const,
      }));

    // 같은 (category, name) 조합이 이미 있으면(수동으로 이미 등록됐거나 이전에 같은 제안이
    // 나온 적 있으면) 건드리지 않고 건너뜁니다 - 관리자가 이미 판단한 상태를 AI가 덮어쓰면
    // 안 되므로 upsert가 아니라 "없을 때만 추가"로 안전하게 처리합니다.
    const { data: inserted, error } = await supabase
      .from("gia_systems")
      .upsert(payload, { onConflict: "category,name", ignoreDuplicates: true })
      .select();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, rows: (inserted as GiaSystem[] | null) ?? [] });
  } catch (err) {
    await logApiError(supabase, "api:ai:gia-systems-suggest", err, me.email);
    const message = err instanceof Error ? err.message : "제안을 생성하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
