import { callClaudeJson, CLAUDE_MODEL_FAST } from "./claude";

// 교사(주로 영어)와 행정직원(주로 한국어)이 같은 요청/코멘트를 서로 자기 언어로 읽을 수 있도록,
// 텍스트를 한국어·영어 두 버전으로 항상 함께 저장하기 위한 번역 헬퍼입니다(요청: "교사들이
// 원어민이 많기 때문에 요청은 대부분 영어로 할것이라, 등록되는 요청과, 넣는 코멘트 모두 한,영
// 번역을 지원해주고"). 여러 필드를 한 번의 Claude 호출로 함께 번역해 비용을 아낍니다.
//
// 번역 실패는 항상 조용히 {}를 반환합니다 - 원문(title/content)은 이미 정상 저장되므로, 번역이
// 안 붙어도 요청 등록/코멘트 작성 자체는 항상 성공해야 합니다.
export async function translateKoEn(
  fields: Record<string, string>,
  opts?: { route?: string }
): Promise<Record<string, { ko: string; en: string }>> {
  const entries = Object.entries(fields).filter(([, v]) => v && v.trim());
  if (!entries.length) return {};

  const system = `당신은 학교 행정 요청/코멘트를 한국어와 영어로 함께 제공하기 위한 번역기입니다.
입력으로 여러 개의 텍스트 필드가 JSON으로 주어집니다. 각 필드마다 원문의 언어를 판단해서:
- 원문이 한국어라면: ko는 원문 그대로, en은 자연스러운 영어 번역
- 원문이 영어라면: en은 원문 그대로, ko는 자연스러운 한국어 번역
- 두 언어가 섞여 있거나 판단이 애매하면 최선을 다해 두 언어 모두 자연스럽게 작성
말투는 학교 행정 요청에 어울리게 정중하고 간결하게 유지하고, 학생 이름 등 고유명사는 바꾸지
마세요. 반드시 JSON 객체 하나만 답하세요. 형식: {"필드명": {"ko": "...", "en": "..."}, ...}
(입력에 없던 필드명을 추가하지 마세요.)`;

  const userPrompt = JSON.stringify(Object.fromEntries(entries));

  try {
    const result = await callClaudeJson(system, userPrompt, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 2000,
      route: opts?.route ?? "requests-translate",
    });
    if (result && typeof result === "object") {
      return result as Record<string, { ko: string; en: string }>;
    }
    return {};
  } catch {
    return {};
  }
}
