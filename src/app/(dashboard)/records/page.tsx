import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { Incident, PolicyCategory } from "@/lib/types";
import IncidentsClient from "@/components/incidents/IncidentsClient";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const supabase = await createClient();
  const [{ data }, currentTerm, me, { data: policyCategories }] = await Promise.all([
    supabase.from("incidents").select("*").order("date", { ascending: false }).limit(200),
    getCurrentTerm(),
    getCurrentAppUser(),
    // 매뉴얼(실무자용)/운영계획안(학부모용) 항목 선택 드롭다운용 - 고정 목록이라 통째로
    // 가져와도 부담이 없습니다(요청: "그 항목을 기준으로 사건,회의,운영계획안을 항목화").
    supabase.from("policy_categories").select("*").order("target_doc").order("domain").order("sort_order"),
  ]);

  return (
    <IncidentsClient
      initialItems={(data as Incident[]) ?? []}
      currentTerm={currentTerm}
      currentUserEmail={me?.email ?? ""}
      currentUserName={me?.name || me?.email || ""}
      policyCategories={(policyCategories as PolicyCategory[] | null) ?? []}
    />
  );
}
