import type { Term } from "@/lib/types";

// 여러 화면(홈/사이드바/사건기록/회의기록)에서 "지금 진행 중인 학기·캠프"를 같은 기준으로
// 가져오기 위한 공용 헬퍼입니다. status가 "진행중"인 학기 중 가장 최근에 시작한 것을 하나
// 고릅니다(시작일이 없으면 등록일 기준). 담당자가 여러 개를 진행중으로 켜둔 실수를 해도
// 화면이 깨지지 않도록 항상 1건만 돌려줍니다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCurrentTerm(supabase: any): Promise<Term | null> {
  const { data } = await supabase
    .from("terms")
    .select("*")
    .eq("status", "진행중")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
  return (data && data[0]) ?? null;
}
