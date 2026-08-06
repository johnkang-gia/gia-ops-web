// AI 사용량(과금) 추정 및 기능별 on/off 토글에 쓰는 상수입니다.
// 요금은 Anthropic 공식 요금표(https://platform.claude.com/docs/en/about-claude/pricing) 기준이며,
// 실제 청구서와는 캐시/도구사용 등으로 소폭 차이가 날 수 있는 "추정치"입니다.
//
// ⚠️ Sonnet 5는 2026-08-31까지 도입 특가($2/$10)이고, 이후 정가($3/$15/백만 토큰)로 오릅니다.
// 날짜가 지나면 아래 두 상수를 갱신해주세요.
export const MODEL_PRICING_USD_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 2.0, out: 10.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING_USD_PER_MTOK[model];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
}

export function formatUsd(amount: number): string {
  if (amount < 0.01 && amount > 0) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}

// 앱에서 실제로 Claude를 호출하는 모든 지점(opts.route)을 항목화한 목록입니다.
// src/app/api 아래 route.ts 파일들의 callClaudeJson(..., { route: "..." }) 호출을 기준으로 정리했습니다.
// 새 AI 기능을 추가할 때는 여기에도 함께 등록해주세요(등록 안 된 route는 기본적으로 켜진 것으로 동작합니다).
export const AI_FEATURES: { key: string; label: string; group: string }[] = [
  { key: "scan:incidents", label: "사건기록 정리 AI", group: "기록함" },
  { key: "scan:events", label: "행사기록 정리 AI", group: "기록함" },
  { key: "scan:meetings", label: "회의기록 정리 AI", group: "기록함" },
  { key: "fill-incident", label: "사건기록 자동작성 AI", group: "기록함" },
  { key: "clean-meeting", label: "회의록 다듬기 AI", group: "기록함" },
  { key: "meeting-chat", label: "회의록 챗봇 AI", group: "기록함" },
  { key: "compare-events", label: "행사 비교분석 AI", group: "기록함" },
  { key: "compare-terms", label: "학기 비교분석 AI", group: "기록함" },
  { key: "manual-draft", label: "매뉴얼 초안작성 AI", group: "매뉴얼 · 문서" },
  { key: "manual-faq", label: "매뉴얼 FAQ AI", group: "매뉴얼 · 문서" },
  { key: "document-draft", label: "서류 초안작성 AI", group: "매뉴얼 · 문서" },
  { key: "document-recommend", label: "서류 추천 AI", group: "매뉴얼 · 문서" },
  { key: "review-adopted", label: "채택예정 검토 AI", group: "제안함 · 채택예정" },
  { key: "proposals-decide", label: "제안 승인 정리 AI", group: "제안함 · 채택예정" },
  { key: "proposals-decide-parent-tone", label: "학부모용 승인 톤 다듬기 AI", group: "제안함 · 채택예정" },
  { key: "analyze-task", label: "업무 분석 AI", group: "업무" },
  { key: "education-news", label: "교육뉴스 AI (웹검색)", group: "관리자" },
  { key: "gia-systems-suggest", label: "GIA시스템 벤치마킹 AI (웹검색)", group: "관리자" },
];
