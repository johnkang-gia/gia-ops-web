// GIA_매뉴얼_자동화_v18_회사계정.gs의 callClaudeJson()을 Node fetch로 옮긴 것입니다.
// 서버(Route Handler)에서만 import 하세요 - ANTHROPIC_API_KEY는 절대 클라이언트에 노출하면 안 됩니다.
//
// 비용 절감을 위해 작업 성격에 따라 모델을 나눠 씁니다:
// - CLAUDE_MODEL_QUALITY(Sonnet): 학부모에게 직접 나가는 문구(안내 메시지)나 어느 문서(학부모용/
//   실무자용)에 반영할지처럼 판단이 틀리면 학부모 클레임/법적 리스크로 이어질 수 있는 작업.
// - CLAUDE_MODEL_FAST(Haiku): 맞춤법 정리, 이미 결정된 회의 내용 분류처럼 상대적으로 기계적이고
//   실수해도 사람이 검토 단계에서 바로 잡을 수 있는 작업. Haiku가 Sonnet 대비 훨씬 저렴합니다.
// 시스템 프롬프트에 prompt caching(ephemeral)을 적용해 반복 호출 시 입력 토큰 비용도 줄입니다.
//
// opts.route를 넘기면 호출마다 ai_usage_logs에 라우트/모델/토큰수/성공여부가 자동 기록되어,
// 개발자 대시보드에서 어떤 기능이 AI를 얼마나 쓰는지 볼 수 있습니다(로깅 실패는 무시하고 넘어감).
import { createClient } from "@/lib/supabase/server";
import { logAiUsage } from "@/lib/logging";
import { SHARED_CACHE_CONTEXT } from "@/lib/ai/prompts";

export const CLAUDE_MODEL_QUALITY = "claude-sonnet-5";
export const CLAUDE_MODEL_FAST = "claude-haiku-4-5-20251001";

// 요청("6개 AI 프롬프트가 각자 기관 소개문·법령 목록(공통 콘텐츠)을 매번 새로 캐싱하고 있는데,
// 이걸 하나의 공유 캐시 블록으로 묶어서 캐시적중률을 올려줘"): 시스템 프롬프트가 prompts.ts의
// SHARED_CACHE_CONTEXT로 시작하면, 그 부분만 별도 cache_control 블록으로 잘라서 보냅니다.
// Claude API의 prompt caching은 "완전히 동일한 접두사"에만 적중하므로, 예전처럼 시스템 프롬프트
// 전체를 통째로 캐싱하면 라우트마다 뒷부분 문구가 달라 사실상 서로 다른 캐시 항목이 되어 절대
// 공유되지 않았습니다. 공용 부분과 라우트별 부분을 나눠서 각각 캐시 브레이크포인트를 두면, 같은
// 5분 캐시 유효시간 안에 다른 AI 기능이 먼저 호출됐어도 앞부분(기관 소개문 + 법령 목록)은 다시
// 캐싱하지 않아 입력 토큰 비용이 줄어듭니다. 접두사가 일치하지 않는(공용 콘텐츠를 안 쓰는) 시스템
// 프롬프트는 예전처럼 한 블록으로만 보냅니다.
type SystemBlock = { type: "text"; text: string; cache_control: { type: "ephemeral" } };
function buildSystemBlocks(systemPrompt: string): SystemBlock[] {
  if (systemPrompt.startsWith(SHARED_CACHE_CONTEXT)) {
    const rest = systemPrompt.slice(SHARED_CACHE_CONTEXT.length);
    return [
      { type: "text", text: SHARED_CACHE_CONTEXT, cache_control: { type: "ephemeral" } },
      { type: "text", text: rest, cache_control: { type: "ephemeral" } },
    ];
  }
  return [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
}

// 개발자 대시보드에서 과금이 부담스러운 AI 기능을 항목별로 끌 수 있게 하는 게이트입니다.
// ai_feature_flags에 route가 없으면(신규 기능이라 아직 등록 안 됐거나, 조회 자체가 실패하면)
// "허용"으로 처리합니다 - 조회 실패 때문에 정상 기능까지 막히면 안 되기 때문입니다.
async function isFeatureEnabled(route: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("ai_feature_flags")
      .select("enabled")
      .eq("key", route)
      .maybeSingle();
    if (!data) return true;
    return data.enabled !== false;
  } catch {
    return true;
  }
}

export async function callClaudeJson(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; model?: string; route?: string }
): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const maxTokens = opts?.maxTokens ?? 8000;
  const model = opts?.model ?? CLAUDE_MODEL_QUALITY;
  const route = opts?.route ?? "unknown";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  async function recordUsage(success: boolean, errorMessage?: string) {
    try {
      const supabase = await createClient();
      await logAiUsage(supabase, { route, model, inputTokens, outputTokens, success, errorMessage });
    } catch {
      // 로깅 실패는 무시(AI 응답 자체에는 영향 없음)
    }
  }

  try {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다(Vercel 환경변수 확인).");
    }
    if (!(await isFeatureEnabled(route))) {
      throw new Error("현재 이 AI 기능은 관리자에 의해 일시정지되어 있습니다. 잠시 후 다시 시도해주세요.");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: buildSystemBlocks(systemPrompt),
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const raw = await response.text();
    let json: {
      error?: { message?: string };
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`Claude API 응답을 해석할 수 없습니다(코드 ${response.status}): ${raw.slice(0, 300)}`);
    }
    if (json.usage) {
      inputTokens = json.usage.input_tokens ?? null;
      outputTokens = json.usage.output_tokens ?? null;
    }
    if (json.error) {
      throw new Error(`Claude API 오류: ${json.error.message || JSON.stringify(json.error)}`);
    }
    if (!response.ok) {
      throw new Error(`Claude API 오류(코드 ${response.status}): ${raw.slice(0, 300)}`);
    }
    if (!json.content || !json.content.length) {
      throw new Error(`Claude 응답에 내용이 없습니다: ${raw.slice(0, 300)}`);
    }
    const textBlock = json.content.find((b) => b && b.type === "text" && typeof b.text === "string");
    if (!textBlock || !textBlock.text) {
      throw new Error(`Claude 응답에서 텍스트를 찾을 수 없습니다: ${JSON.stringify(json.content).slice(0, 300)}`);
    }
    let text = textBlock.text.trim();
    text = text
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Claude 응답을 JSON으로 해석하지 못했습니다: ${text.slice(0, 300)}`);
    }
    await recordUsage(true);
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordUsage(false, message);
    throw err;
  }
}

// 교육뉴스/GIA시스템 벤치마킹처럼 "최신 웹 정보"가 필요한 기능을 위한 버전입니다. Anthropic이
// 서버에서 직접 검색을 수행하는 web_search 도구를 붙여서 호출합니다(우리가 직접 검색 API를
// 연동할 필요 없이, 한 번의 메시지 요청 안에서 Claude가 알아서 여러 번 검색하고 최종 답을
// 만들어 돌려줍니다). 응답 content에는 검색 과정(server_tool_use/web_search_tool_result)과
// 최종 텍스트가 섞여 있는데, 우리는 마지막 text 블록만 최종 답으로 취급합니다 - 프롬프트에서
// "최종 답은 반드시 JSON 하나만"이라고 명시해야 안전하게 파싱됩니다.
export async function callClaudeJsonWithWebSearch(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; model?: string; route?: string; maxSearches?: number }
): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const maxTokens = opts?.maxTokens ?? 8000;
  const model = opts?.model ?? CLAUDE_MODEL_QUALITY;
  const route = opts?.route ?? "unknown";
  const maxSearches = opts?.maxSearches ?? 6;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  async function recordUsage(success: boolean, errorMessage?: string) {
    try {
      const supabase = await createClient();
      await logAiUsage(supabase, { route, model, inputTokens, outputTokens, success, errorMessage });
    } catch {
      // 로깅 실패는 무시(AI 응답 자체에는 영향 없음)
    }
  }

  try {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다(Vercel 환경변수 확인).");
    }
    if (!(await isFeatureEnabled(route))) {
      throw new Error("현재 이 AI 기능은 관리자에 의해 일시정지되어 있습니다. 잠시 후 다시 시도해주세요.");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: buildSystemBlocks(systemPrompt),
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
      }),
    });

    const raw = await response.text();
    let json: {
      error?: { message?: string };
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`Claude API 응답을 해석할 수 없습니다(코드 ${response.status}): ${raw.slice(0, 300)}`);
    }
    if (json.usage) {
      inputTokens = json.usage.input_tokens ?? null;
      outputTokens = json.usage.output_tokens ?? null;
    }
    if (json.error) {
      throw new Error(`Claude API 오류: ${json.error.message || JSON.stringify(json.error)}`);
    }
    if (!response.ok) {
      throw new Error(`Claude API 오류(코드 ${response.status}): ${raw.slice(0, 300)}`);
    }
    if (json.stop_reason === "pause_turn") {
      throw new Error("검색이 길어져 응답이 끊겼습니다. 잠시 후 다시 시도해주세요.");
    }
    const textBlocks = (json.content ?? []).filter(
      (b): b is { type: string; text: string } => b && b.type === "text" && typeof b.text === "string"
    );
    if (!textBlocks.length) {
      throw new Error(`Claude 응답에서 텍스트를 찾을 수 없습니다: ${JSON.stringify(json.content).slice(0, 300)}`);
    }
    let text = textBlocks[textBlocks.length - 1].text.trim();
    text = text
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Claude 응답을 JSON으로 해석하지 못했습니다: ${text.slice(0, 300)}`);
    }
    await recordUsage(true);
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordUsage(false, message);
    throw err;
  }
}
