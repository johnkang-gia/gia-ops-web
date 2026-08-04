import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { ManualSection, SchoolDocument } from "@/lib/types";
import SchoolDocumentsHubClient from "@/components/documents/SchoolDocumentsHubClient";

export const dynamic = "force-dynamic";

// "학교 문서함" 홈 - 예전에는 매뉴얼/운영계획안/서류함/업무보고서/회의보고서가 각각 다른
// 메뉴에 흩어져 있어서, 새로 만들어진 문서가 있어도 어디서 찾아야 할지 알기 어려웠습니다.
// 여기서 매뉴얼(manual_sections)과 서류함(documents)에 실제로 저장된 문서를 모아 최근
// 등록·수정 순으로 보여주고, 이름/카테고리로 바로 검색할 수 있게 했습니다. 업무·회의
// 보고서는 저장된 문서가 아니라 그때그때 만들어 인쇄하는 형태라 이 목록에는 포함하지 않고,
// 상단 카드에서 곧바로 보고서 화면으로 연결합니다.
export default async function SchoolDocumentsHubPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const [{ data: manualsData }, { data: documentsData }] = await Promise.all([
    supabase.from("manual_sections").select("*").order("updated_at", { ascending: false }),
    supabase.from("documents").select("*").order("updated_at", { ascending: false }),
  ]);

  return (
    <SchoolDocumentsHubClient
      manuals={(manualsData as ManualSection[] | null) ?? []}
      documents={(documentsData as SchoolDocument[] | null) ?? []}
    />
  );
}
