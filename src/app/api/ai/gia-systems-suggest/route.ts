import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { callClaudeJsonWithWebSearch } from "@/lib/ai/claude";
import { logApiError } from "@/lib/logging";
import type { GiaSystem } from "@/lib/types";

// GIA시스템 화면의 대분류 체계와 정확히 맞춰야 AI 제안도 같은 탭 안에 자연스럽게 섞입니다(요청:
// "대분류항목에서부터 더 들어가서 ... 항목을 세분화"). 새 대분류를 만들어내지 말고 이 8개 중
// 가장 가까운 것을 고르도록 안내합니다.
const MAJORS = ["재정", "인사·교직원", "학사", "운영", "시설·안전", "입학·홍보", "행정·문서", "정보보안·법무"];

const SYSTEM_PROMPT = `당신은 한국의 소규모 국제학교(대안교육기관) GIA International School의 운영진을 위해
"다른 국제학교/공립학교는 갖췄는데 GIA는 아직 없거나 부족한 운영 시스템"을 조사하는 리서치 어시스턴트입니다.

이 기능은 오직 두 가지 용도로만 씁니다:
1) GIA에 아예 없는 시스템을 새로 추가 제안
2) 이미 있는 항목이 너무 뭉뚱그려져 있어서 더 구체적으로 쪼갤 수 있는지(세분화) 체크해서 제안
절대로 아래 "이미 갖췄거나 이미 검토한" 목록의 기존 항목을 고치거나 대체하는 제안을 하지 마세요 -
관리자가 이미 정리해둔 기존 항목은 그대로 유지되어야 하며, 당신의 역할은 새로 추가할 것을 "제안"
하는 것뿐입니다(실제로 반영할지는 관리자가 판단합니다).

web_search 도구로 국내외 국제학교/사립학교/공립학교의 학교 운영 시스템(재정/회계, 인사/노무, 학사/입학,
시설/안전, 입학/홍보, 행정/문서, 정보보안/법무 등 전반) 사례를 찾아보고, GIA가 참고할 만한 구체적인
시스템을 제안하세요. 실제로 검색해서 확인한 사례만 근거로 삼고, 막연한 일반론은 피하세요.

아래는 GIA가 "이미 갖췄거나 이미 검토한" 항목 목록입니다(대분류/중분류/이름 순) - 이 항목들의 이름을
그대로 다시 제안하지 마세요. 대신:
- 목록에 없는 완전히 새로운 시스템이 있다면 "추가" 제안으로 올리세요(이 경우 refines_existing은 null).
- 목록에 있는 어떤 항목이 실제로는 여러 하위 제도를 뭉뚱그린 것으로 보이면(예: "인사 규정"처럼
  포괄적인 이름 하나로만 있고, 실제로는 "채용 규정", "평가 규정", "징계 규정" 등으로 나뉘어 있어야
  더 명확하다면), 그 기존 항목 이름은 그대로 둔 채 더 구체적인 하위 항목을 새 제안으로 추가하고,
  refines_existing에 어떤 기존 항목을 세분화한 것인지 정확한 이름을 적으세요.
{{EXISTING}}

마지막 응답은 반드시 아래 스키마의 JSON 객체 "하나만" 출력하세요(다른 설명 문장 금지):
{
  "suggestions": [
    {
      "major": "재정" | "인사·교직원" | "학사" | "운영" | "시설·안전" | "입학·홍보" | "행정·문서" | "정보보안·법무",
      "category": "중분류(예: 재정 대분류 안이면 예산·회계/등록금·수납/구매·계약 등, 짧고 명확하게)",
      "name": "시스템/제도 이름(간결하게)",
      "description": "무엇이고 왜 GIA에 필요한지 2~4문장(한국어)",
      "benchmark_school": "참고한 실제 사례(학교/기관명, 검색으로 확인된 경우만)",
      "refines_existing": "세분화 제안이면 그 기존 항목의 정확한 이름, 완전히 새로운 추가 제안이면 null"
    }
  ]
}`;

export async function POST() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 사용할 수 있습니다." }, { status: 403 });

  try {
    const { data: existingRows } = await supabase.from("gia_systems").select("major, category, name, status");
    const existingText =
      ((existingRows as { major: string; category: string; name: string; status: string }[] | null) ?? [])
        .map((r) => `- [${r.major} / ${r.category}] ${r.name} (${r.status})`)
        .join("\n") || "(없음)";

    const systemPrompt = SYSTEM_PROMPT.replace("{{EXISTING}}", existingText);
    const result = (await callClaudeJsonWithWebSearch(
      systemPrompt,
      `대분류: ${MAJORS.join(", ")}. 위 기준으로 GIA에 부족한 시스템을 제안해주세요.`,
      { route: "gia-systems-suggest", maxTokens: 4000, maxSearches: 4 }
    )) as {
      suggestions?: {
        major: string;
        category: string;
        name: string;
        description: string;
        benchmark_school?: string;
        refines_existing?: string | null;
      }[];
    };

    const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    if (suggestions.length === 0) {
      return NextResponse.json({ success: true, rows: [] });
    }

    // 기존 항목과 이름이 완전히 같은 제안은(추가/세분화 어느 쪽이든) 원본을 건드리지 않도록
    // 아예 걸러냅니다 - unique index(major,category,name)로도 막히지만, 여기서 한 번 더
    // 확실히 걸러서 "기존 항목은 절대 건드리지 않는다"는 원칙을 코드 레벨에서도 보장합니다.
    const existingNames = new Set(
      ((existingRows as { major: string; category: string; name: string; status: string }[] | null) ?? []).map(
        (r) => `${r.major}::${r.category}::${r.name}`
      )
    );

    const payload = suggestions
      .filter((s) => s.name?.trim() && s.category?.trim())
      .map((s) => ({
        major: MAJORS.includes(s.major?.trim()) ? s.major.trim() : "운영",
        category: s.category.trim(),
        name: s.name.trim(),
        status: "미보유" as const,
        description: s.description?.trim() || null,
        benchmark_school: s.benchmark_school?.trim() || null,
        source: "ai_suggested" as const,
        refines_name: s.refines_existing?.trim() || null,
      }))
      .filter((s) => !existingNames.has(`${s.major}::${s.category}::${s.name}`));

    // 같은 (major, category, name) 조합이 이미 있으면(수동으로 이미 등록됐거나 이전에 같은
    // 제안이 나온 적 있으면) 건드리지 않고 건너뜁니다 - 관리자가 이미 판단한 상태를 AI가
    // 덮어쓰면 안 되므로 upsert가 아니라 "없을 때만 추가"로 안전하게 처리합니다.
    const { data: inserted, error } = await supabase
      .from("gia_systems")
      .upsert(payload, { onConflict: "major,category,name", ignoreDuplicates: true })
      .select();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, rows: (inserted as GiaSystem[] | null) ?? [] });
  } catch (err) {
    await logApiError(supabase, "api:ai:gia-systems-suggest", err, me.email);
    const message = err instanceof Error ? err.message : "제안을 생성하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
