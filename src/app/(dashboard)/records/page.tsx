import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { Incident, GiaSystem } from "@/lib/types";
import IncidentsClient from "@/components/incidents/IncidentsClient";
import WorkTabs from "@/components/work/WorkTabs";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const supabase = await createClient();
  const [{ data }, currentTerm, me, { data: giaSystems }] = await Promise.all([
    supabase.from("incidents").select("*").order("date", { ascending: false }).limit(200),
    getCurrentTerm(),
    getCurrentAppUser(),
    // 매뉴얼(실무자용)/운영계획안(학부모용) 항목 선택 드롭다운용. 요청("사건기록의 매뉴얼항목·
    // 운영계획안항목을 GIA시스템에 나온 항목으로 분류")에 따라 policy_categories 대신
    // gia_systems(대분류>중분류>세부항목)에서 고정 목록을 가져옵니다.
    supabase.from("gia_systems").select("*").order("major").order("category").order("name"),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <WorkTabs />
      <IncidentsClient
      initialItems={(data as Incident[]) ?? []}
      currentTerm={currentTerm}
      currentUserEmail={me?.email ?? ""}
      currentUserName={me?.name || me?.email || ""}
      giaSystems={(giaSystems as GiaSystem[] | null) ?? []}
    />
    </div>  );
}
