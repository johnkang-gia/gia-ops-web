import { createClient } from "@/lib/supabase/server";
import type { Adopted } from "@/lib/types";
import { loadProposalSourceContext } from "@/lib/proposalSource";
import AdoptedClient from "@/components/adopted/AdoptedClient";

export const dynamic = "force-dynamic";

// 제안함(ProposalsClient)과 같은 방식으로, 채택예정 카드에도 "이 항목이 어떤 사건/행사/회의/
// 초안에서 나온 건지" 개요를 보여줍니다(요청: "채택예정도 제안함처럼 깔끔하게"). adopted.source_id는
// 원본 기록의 case_id 그대로이므로 proposals/page.tsx와 동일한 방식으로 조회합니다. complaint(예상
// 문의)·system(GIA시스템)은 origin 개념이 다르거나 없어서 이 조회 대상에서 제외합니다.
export default async function AdoptedPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("adopted")
    .select("*")
    .eq("publish", false)
    .order("date", { ascending: false })
    .limit(200);

  const items = (data as Adopted[]) ?? [];

  const sourceContext = await loadProposalSourceContext(supabase, items);

  return (
    <div className="p-4 sm:p-6">
      <AdoptedClient initialItems={items} sourceContext={sourceContext} />
    </div>
  );
}
