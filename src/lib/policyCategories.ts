// 운영계획안(학부모용)/매뉴얼(실무자용)의 고정 항목 목록(policy_categories)을 읽어 AI 분류
// 프롬프트에 실어 보내는 공용 헬퍼입니다. 예전에는 이미 발행된 manual_sections.category
// 값을 "참고용 힌트"로만 보냈지만(AI가 그 목록에 없으면 자유롭게 새 이름을 지어낼 수 있었음),
// 요청("Gia시스템을 참조했을 때... 그 항목을 기준으로 사건,회의,운영계획안을 항목화")과 그
// 확인 답변("새 항목 체계로 완전히 대체")에 따라 이제 policy_categories에 미리 정리해둔 고정
// 목록만을 기준으로 삼습니다 - AI는 이 목록 중에서만 골라야 합니다(자유 생성 금지).
export type PolicyCategoryNames = { parent: string[]; staff: string[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPolicyCategoryNames(supabase: any): Promise<PolicyCategoryNames> {
  const { data } = await supabase
    .from("policy_categories")
    .select("target_doc, category")
    .order("sort_order", { ascending: true });
  const rows = (data || []) as { target_doc: string; category: string }[];
  return {
    parent: rows.filter((r) => r.target_doc === "학부모용").map((r) => r.category),
    staff: rows.filter((r) => r.target_doc === "실무자용").map((r) => r.category),
  };
}
