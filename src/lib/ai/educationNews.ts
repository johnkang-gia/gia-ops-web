// 교육뉴스 생성 로직을 관리자 화면의 수동 생성 버튼(/api/ai/education-news)과 주 2회(월/수)
// 자동 실행되는 Vercel Cron(/api/cron/education-news)이 함께 씁니다 - 로그인 세션 유무만
// 다르고 실제 생성 로직은 완전히 같아서, 중복 없이 여기 한 곳에만 둡니다.
import { callClaudeJsonWithWebSearch, CLAUDE_MODEL_QUALITY } from "./claude";
import { genCaseId } from "@/lib/caseId";
import type { EducationNewsItem } from "@/lib/types";

const SYSTEM_PROMPT = `당신은 한국의 국제학교(대안교육기관) GIA International School의 운영진(부이사장/이사장급)을 위해
교육 뉴스 브리핑을 작성하는 리서치 어시스턴트입니다. GIA는 현재 초등부(유치부/중고등부로 확장 예정)를
운영하는 소규모 국제학교입니다.

web_search 도구를 사용해 최근 1~2주 이내의 다음 주제 관련 최신 소식을 찾아 한국어로 정리하세요:
- 국제학교/대안교육기관 관련 국내외 동향, 신규 정책/규제 변화
- 최신 교육 트렌드(커리큘럼, 에듀테크, 평가방식 등) 중 소규모 국제학교에 실질적으로 도움될 만한 것
- 참고할 만한 해외/국내 국제학교의 운영 사례

각 항목은 실제로 검색해 확인한 사실에 기반해야 하며, 반드시 출처(기사/공식 페이지) 링크를 포함하세요.
검색으로 확인되지 않는 내용은 만들어내지 마세요. 관련성 높은 소식이 적으면 억지로 채우지 말고
2~5개 항목만 알차게 제공하세요.

검색과 사고 과정을 모두 마친 뒤, 마지막 응답은 반드시 아래 스키마의 JSON 객체 "하나만" 출력하세요
(다른 설명 문장을 앞뒤에 절대 붙이지 마세요):
{
  "title": "짧은 다이제스트 제목(예: 2026년 8월 첫째주 국제교육 브리핑)",
  "summary": "전체 소식을 1~2문장으로 요약",
  "items": [
    {
      "category": "국제학교 동향" | "정책/규제" | "교육 트렌드",
      "headline": "소식 제목(한국어, 간결하게)",
      "body": "2~4문장 요약(한국어) - GIA 운영에 어떤 시사점이 있는지도 한 줄 포함",
      "source_name": "출처 매체/기관명",
      "source_url": "출처 URL"
    }
  ]
}`;

function buildUserPrompt(todayLabel: string) {
  return `오늘은 ${todayLabel}입니다. 위 기준으로 최신 교육뉴스 브리핑을 만들어주세요.`;
}

export type GeneratedEducationNews = {
  case_id: string;
  published_date: string;
  title: string;
  summary: string;
  items: EducationNewsItem[];
  model: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateEducationNews(supabaseAdmin: any): Promise<GeneratedEducationNews> {
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayLabel = todayKst.toISOString().slice(0, 10);

  const result = (await callClaudeJsonWithWebSearch(SYSTEM_PROMPT, buildUserPrompt(todayLabel), {
    route: "education-news",
    maxTokens: 6000,
    maxSearches: 8,
  })) as { title?: string; summary?: string; items?: EducationNewsItem[] };

  const title = result.title?.trim() || `${todayLabel} 교육뉴스`;
  const summary = result.summary?.trim() || "";
  const items = Array.isArray(result.items) ? result.items : [];

  const row: GeneratedEducationNews = {
    case_id: genCaseId("NEWS"),
    published_date: todayLabel,
    title,
    summary,
    items,
    model: CLAUDE_MODEL_QUALITY,
  };

  const { error } = await supabaseAdmin.from("education_news").insert(row);
  if (error) throw new Error(error.message);

  return row;
}
