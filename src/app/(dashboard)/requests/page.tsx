import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { StaffRequest } from "@/lib/types";
import StaffRequestsClient from "@/components/requests/StaffRequestsClient";

export const dynamic = "force-dynamic";

// 행정 요청 - 교사가 사물함 파손·물품 구입·아픈 학생 인계·출결 문의 같은 일들을 행정직원에게
// 등록하고, 행정직원/관리자가 접수대기→처리중→완료로 처리하는 화면입니다(요청: "교사는
// 행정부에... 요청하는 여러 일들"). isManager이면 전체 목록+상태변경, 아니면(교사 등) 본인이
// 등록한 요청만 보고 새 요청을 등록합니다.
export default async function StaffRequestsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  const isManager = isStaffOrAboveUser(me);

  const { data } = await supabase
    .from("staff_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  return (
    <StaffRequestsClient
      initialItems={(data as StaffRequest[]) ?? []}
      isManager={isManager}
      myEmail={me?.email ?? ""}
    />
  );
}
