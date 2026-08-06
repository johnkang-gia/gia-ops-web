// 운영계획안(학부모용)/매뉴얼(실무자용)의 고정 항목 목록을 AI 분류 프롬프트에 실어 보내는
// 공용 헬퍼입니다. 예전에는 이 목록을 policy_categories 테이블(별도로 벤치마킹해 만든 목록)에서
// 가져왔지만, 요청("사건기록에서 매뉴얼항목과 운영계획안 항목을 GIA시스템에 나온 항목으로
// 분류해주고, AI가 분류할 때 해당항목별로 분류할 수 있도록")과 확인 답변("GIA시스템 목록으로
// 완전 대체")에 따라 이제 gia_systems(대분류>중분류>세부항목)의 세부항목 이름만을 기준으로
// 삼습니다 - AI는 이 목록 중에서만 골라야 합니다(자유 생성 금지). gia_systems에는 학부모용/
// 실무자용 구분이 따로 없으므로, 두 문서 모두 같은 세부항목 목록을 공유하고(parent/staff가
// 동일한 배열), 실제로 어느 문서에 실릴지(targetDoc)는 AI가 이 값과 별개로 판단합니다.
// (참고: 정책 항목 관리 화면/policy_categories 테이블 자체는 그대로 남아있지만, 이 변경 이후로는
// 사건/회의 AI 분류에 더 이상 쓰이지 않습니다.)
export type PolicyCategoryNames = { parent: string[]; staff: string[] };

// GiaSystemsClient.tsx의 순서와 맞춰야 항목이 매번 같은 순서로 나옵니다.
const MAJOR_ORDER = ["재정", "인사·교직원", "학사", "운영", "시설·안전", "입학·홍보", "행정·문서", "정보보안·법무"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPolicyCategoryNames(supabase: any): Promise<PolicyCategoryNames> {
  const { data } = await supabase.from("gia_systems").select("major, category, name");
  const rows = (data || []) as { major: string; category: string; name: string }[];
  const names = rows
    .slice()
    .sort((a, b) => {
      const ia = MAJOR_ORDER.indexOf(a.major);
      const ib = MAJOR_ORDER.indexOf(b.major);
      if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      if (a.category !== b.category) return a.category.localeCompare(b.category, "ko");
      return a.name.localeCompare(b.name, "ko");
    })
    .map((r) => r.name);
  return { parent: names, staff: names };
}
