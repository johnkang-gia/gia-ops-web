// GIA_매뉴얼_자동화_v18_회사계정.gs의 callClaudeJson()을 Node fetch로 옮긴 것입니다.
// 서버(Route Handler)에서만 import 하세요 - ANTHROPIC_API_KEY는 절대 클라이언트에 노출하면 안 됩니다.

const CLAUDE_MODEL = "claude-sonnet-5";

export async function callClaudeJson(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number }
): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다(Vercel 환경변수 확인).");
  }
  const maxTokens = opts?.maxTokens ?? 8000;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const raw = await response.text();
  let json: {
    error?: { message?: string };
    content?: { type: string; text?: string }[];
  };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Claude API 응답을 해석할 수 없습니다(코드 ${response.status}): ${raw.slice(0, 300)}`);
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
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Claude 응답을 JSON으로 해석하지 못했습니다: ${text.slice(0, 300)}`);
  }
}
