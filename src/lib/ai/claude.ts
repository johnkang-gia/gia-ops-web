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

// 한 번의 AI 호출에서 Supabase 클라이언트를 한 번만 만들어 돌려씁니다. 예전에는 기능 스위치
// 확인에서 한 번, 사용량 기록에서 또 한 번(실패 시 한 번 더) 각각 새로 만들어서, AI 한 번
// 부를 때마다 클라이언트 생성과 쿠키 파싱이 두세 번씩 일어났습니다.
type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

// AI 프롬프트 여섯 개가 각자 기관 소개문·법령 목록(공통 콘텐츠)을 매번 새로 캐싱하고
// 있었습니다. 지금은 시스템 프롬프트가 prompts.ts의 SHARED_CACHE_CONTEXT로 시작하면, 그
// 부분만 별도 cache_control 블록으로 잘라서 보냅니다.
// Claude API의 prompt caching은 "완전히 동일한 접두사"에만 적중하므로, 예전처럼 시스템 프롬프트
// 전체를 통째로 캐싱하면 라우트마다 뒷부분 문구가 달라 사실상 서로 다른 캐시 항목이 되어 절대
// 공유되지 않았습니다. 공용 부분과 라우트별 부분을 나눠서 각각 캐시 브레이크포인트를 두면, 같은
// 5분 캐시 유효시간 안에 다른 AI 기능이 먼저 호출됐어도 앞부분(기관 소개문 + 법령 목록)은 다시
// 캐싱하지 않아 입력 토큰 비용이 줄어듭니다. 접두사가 일치하지 않는(공용 콘텐츠를 안 쓰는) 시스템
// 프롬프트는 예전처럼 한 블록으로만 보냅니다.
type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
function buildSystemBlocks(systemPrompt: string): SystemBlock[] {
  if (systemPrompt.startsWith(SHARED_CACHE_CONTEXT)) {
    // 캐시 표시는 "공용 앞부분"에만 답니다.
    //
    // 예전에는 뒷부분(라우트별 지시문)에도 cache_control을 달았는데, 이건 손해였습니다.
    // Anthropic은 캐시에 처음 쓸 때 입력 토큰을 1.25배로 청구하고, 5분 안에 같은 접두사로
    // 다시 불러야만 본전을 뽑습니다. 그런데 라우트별 뒷부분은 그 라우트 전용이라 하루에 몇 번
    // 부를까 말까 한 기능이 대부분입니다 - 적중은 거의 없고 1.25배만 매번 냈습니다.
    // 앞부분은 여러 라우트가 글자까지 똑같이 공유하므로 적중 가능성이 있어 그대로 둡니다.
    return [
      { type: "text", text: SHARED_CACHE_CONTEXT, cache_control: { type: "ephemeral" } },
      { type: "text", text: systemPrompt.slice(SHARED_CACHE_CONTEXT.length) },
    ];
  }
  // 공용 앞부분을 쓰지 않는 프롬프트는 그 라우트에서만 쓰이므로 캐싱해도 적중하지 않습니다.
  return [{ type: "text", text: systemPrompt }];
}

// ── 응답에서 JSON 을 꺼내는 일은 한 곳에서만 합니다 ──────────────────────
//
// 두 호출(검색 없는 판 · 검색 붙은 판)이 각자 파싱하고 있었고, **양쪽이 서로 다르게
// 틀렸습니다.**
//
//   · 검색 없는 판  `content.find(text)` — **첫** 텍스트 블록만
//   · 검색 붙은 판  `blocks[length - 1]`  — **마지막** 텍스트 블록만
//
// Claude 는 답을 한 블록에 담는다고 약속하지 않습니다. 검색이 섞이면 생각·인용·최종 답이
// 여러 text 블록으로 나뉘고, 그러면 어느 쪽이든 **JSON 의 일부만** 파싱합니다. 개발자 오류
// 기록의 `cron:education-news` 실패가 문장 중간부터 시작하는 이유가 이것입니다.
//
//   Claude 응답을 JSON으로 해석하지 못했습니다: 육 격차 해소를 위한 …
//
// 그리고 **길이에서 잘린 것을 아무도 안 봤습니다.** `stop_reason` 을 검색 붙은 판만 보고
// 그것도 `pause_turn` 만 봤습니다. `max_tokens` 로 끊기면 여는 중괄호만 있는 글자가 그대로
// 파싱으로 넘어가고, 사람에게는 「해석하지 못했습니다」로만 보입니다 - **원인이 길이라는
// 사실이 어디에도 안 남습니다.** 고치는 곳이 다르므로(프롬프트가 아니라 max_tokens) 이
// 구별이 중요합니다.
type ClaudeReply = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
};

function parseJsonReply(json: ClaudeReply): unknown {
  const blocks = (json.content ?? []).filter(
    (b): b is { type: string; text: string } => !!b && b.type === "text" && typeof b.text === "string",
  );
  if (blocks.length === 0) {
    throw new Error(`Claude 응답에서 텍스트를 찾을 수 없습니다: ${JSON.stringify(json.content).slice(0, 300)}`);
  }

  // 잘렸는지를 **파싱 전에** 봅니다. 잘린 글자는 어차피 JSON 이 아니고, 그때 나오는
  // 「해석하지 못했습니다」는 원인을 가립니다.
  if (json.stop_reason === "pause_turn") {
    throw new Error("검색이 길어져 응답이 끊겼습니다. 잠시 후 다시 시도해주세요.");
  }
  if (json.stop_reason === "max_tokens") {
    throw new Error("응답이 최대 길이에 닿아 잘렸습니다. 한 번에 요청하는 양을 줄이거나 maxTokens 를 올려주세요.");
  }

  // 블록을 **전부 이어붙입니다.** 어느 하나를 고르면 그 판단이 틀리는 날이 옵니다.
  let text = blocks
    .map((b) => b.text)
    .join("\n")
    .trim();
  text = text
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(text);
  } catch {
    // 앞뒤에 설명이 붙어 온 경우를 살려냅니다 - 가장 바깥 괄호 한 쌍만 떼어 다시 봅니다.
    // 이것마저 실패하면 정말 JSON 이 아닌 것이므로, 원문을 넉넉히 실어 던집니다(300자로
    // 자르면 어디가 어긋났는지 안 보였습니다).
    const first = Math.min(...[text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0));
    const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (Number.isFinite(first) && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        // 아래 공통 오류로 떨어집니다
      }
    }
    const why = json.stop_reason ? ` (끝난 이유: ${json.stop_reason}, 텍스트 블록 ${blocks.length}개)` : "";
    throw new Error(`Claude 응답을 JSON으로 해석하지 못했습니다${why}: ${text.slice(0, 800)}`);
  }
}

// 개발자 대시보드에서 과금이 부담스러운 AI 기능을 항목별로 끌 수 있게 하는 게이트입니다.
// ai_feature_flags에 route가 없으면(신규 기능이라 아직 등록 안 됐거나, 조회 자체가 실패하면)
// "허용"으로 처리합니다 - 조회 실패 때문에 정상 기능까지 막히면 안 되기 때문입니다.
//
// 결과를 60초만 프로세스 안에 들고 있습니다. 이 값은 관리자가 아주 가끔 바꾸는 스위치인데,
// 예전에는 AI를 부를 때마다 DB를 한 번씩 더 다녀왔습니다(스캔·일괄분류처럼 한 요청에서 수십 번
// 호출하는 기능에서는 그만큼 왕복이 늘었습니다). 60초면 스위치를 끈 뒤 늦어도 1분 안에는
// 반영되므로 운영상 문제가 없습니다.
const FLAG_TTL_MS = 60_000;
const flagCache = new Map<string, { enabled: boolean; at: number }>();

async function isFeatureEnabled(route: string, supabase: SupabaseLike): Promise<boolean> {
  const hit = flagCache.get(route);
  if (hit && Date.now() - hit.at < FLAG_TTL_MS) return hit.enabled;
  try {
    const { data } = await supabase.from("ai_feature_flags").select("enabled").eq("key", route).maybeSingle();
    const enabled = !data || data.enabled !== false;
    flagCache.set(route, { enabled, at: Date.now() });
    return enabled;
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

  // 이 호출 전체가 공유하는 클라이언트 하나(기능 스위치 확인 + 사용량 기록에 함께 씁니다).
  let db: SupabaseLike | null = null;
  async function getDb(): Promise<SupabaseLike> {
    if (!db) db = await createClient();
    return db;
  }

  async function recordUsage(success: boolean, errorMessage?: string) {
    try {
      await logAiUsage(await getDb(), { route, model, inputTokens, outputTokens, success, errorMessage });
    } catch {
      // 로깅 실패는 무시(AI 응답 자체에는 영향 없음)
    }
  }

  try {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다(Vercel 환경변수 확인).");
    }
    if (!(await isFeatureEnabled(route, await getDb()))) {
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
      // 검색 없는 판도 잘립니다. 예전에는 이 칸을 안 받아서 「왜 JSON 이 아닌가」를
      // 알 방법이 없었습니다.
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
    if (!json.content || !json.content.length) {
      throw new Error(`Claude 응답에 내용이 없습니다: ${raw.slice(0, 300)}`);
    }
    const parsed = parseJsonReply(json);
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
// 최종 텍스트가 섞여 있습니다. text 블록을 **전부 이어붙여** 파싱합니다(parseJsonReply) -
// 예전에는 마지막 블록만 썼는데, 검색이 섞이면 답이 여러 블록으로 나뉘어 JSON 의 뒷토막만
// 파싱했습니다. 프롬프트에서 "최종 답은 반드시 JSON 하나만"이라고 명시하는 것은 그대로
// 둡니다 - 설명이 덜 섞이면 살려낼 일도 줄어듭니다.
export async function callClaudeJsonWithWebSearch(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; model?: string; route?: string; maxSearches?: number }
): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const maxTokens = opts?.maxTokens ?? 8000;
  const model = opts?.model ?? CLAUDE_MODEL_QUALITY;
  const route = opts?.route ?? "unknown";
  const maxSearches = opts?.maxSearches ?? 4;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  // 이 호출 전체가 공유하는 클라이언트 하나(기능 스위치 확인 + 사용량 기록에 함께 씁니다).
  let db: SupabaseLike | null = null;
  async function getDb(): Promise<SupabaseLike> {
    if (!db) db = await createClient();
    return db;
  }

  async function recordUsage(success: boolean, errorMessage?: string) {
    try {
      await logAiUsage(await getDb(), { route, model, inputTokens, outputTokens, success, errorMessage });
    } catch {
      // 로깅 실패는 무시(AI 응답 자체에는 영향 없음)
    }
  }

  try {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다(Vercel 환경변수 확인).");
    }
    if (!(await isFeatureEnabled(route, await getDb()))) {
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
    const parsed = parseJsonReply(json);
    await recordUsage(true);
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordUsage(false, message);
    throw err;
  }
}
