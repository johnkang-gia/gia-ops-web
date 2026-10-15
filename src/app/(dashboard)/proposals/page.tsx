import { createClient } from "@/lib/supabase/server";
import type { Proposal } from "@/lib/types";
import { loadProposalSourceContext } from "@/lib/proposalSource";
import ProposalsClient from "@/components/proposals/ProposalsClient";

export const dynamic = "force-dynamic";

// 제안 카드에 "이 제안이 어떤 사건/행사/회의/초안에서 나온 건지" 개요를 보여주기 위해(요청 7번:
// "어떤 사건에 대한 건지 사건의 개요를 간략하게 넣어주고"), proposals.source_id(원본 기록의
// case_id)로 사건/행사/회의/AI매뉴얼초안 원본을 한 번에 조회해 맵으로 만듭니다. 예상 문의
// (complaint)·GIA시스템(system)은 origin 개념이 다르거나 없어서 이 조회 대상에서 제외합니다.
export default async function ProposalsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("proposals")
    .select("*")
    .eq("status", "검토대기")
    .order("date", { ascending: false })
    .limit(200);

  const items = (data as Proposal[]) ?? [];

  const sourceContext = await loadProposalSourceContext(supabase, items);

  return (
    <div className="p-4 sm:p-6">
      <ProposalsClient initialItems={items} sourceContext={sourceContext} />
    </div>
  );
}
