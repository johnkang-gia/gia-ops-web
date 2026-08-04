import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Term } from "@/lib/types";

// 여러 화면(홈/사이드바/사건기록/회의기록)에서 "지금 진행 중인 학기·캠프"를 같은 기준으로
// 가져오기 위한 공용 헬퍼입니다. status가 "진행중"인 학기 중 가장 최근에 시작한 것을 하나
// 고릅니다(시작일이 없으면 등록일 기준). 담당자가 여러 개를 진행중으로 켜둔 실수를 해도
// 화면이 깨지지 않도록 항상 1건만 돌려줍니다.
//
// getCurrentAppUser()와 같은 이유로 React cache()로 감쌉니다: layout.tsx와 각 페이지가
// 같은 요청(같은 화면 진입) 안에서 이 함수를 각자 호출하고 있었는데, 인자로 매번 새로 만든
// supabase 클라이언트를 넘기면 cache()가 "다른 호출"로 인식해 중복 제거가 되지 않으므로,
// 클라이언트 생성을 함수 내부로 옮겨 인자 없이 호출하도록 바꿨습니다. 요청이 끝나면 캐시도
// 함께 사라집니다.
export const getCurrentTerm = cache(async (): Promise<Term | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("terms")
    .select("*")
    .eq("status", "진행중")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
  return (data && data[0]) ?? null;
});
