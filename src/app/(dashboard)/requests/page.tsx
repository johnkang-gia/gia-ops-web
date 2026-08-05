import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { StaffRequest, StaffRequestCategoryRow } from "@/lib/types";
import StaffRequestsClient from "@/components/requests/StaffRequestsClient";

export const dynamic = "force-dynamic";

// 행정 요청 - 교사가 사물함 파손·물품 구입·아픈 학생 인계·출결 문의 같은 일들을 행정직원에게
// 등록하고, 행정직원/관리자가 접수대기→처리중→완료로 처리하는 화면입니다(요청: "교사는
// 행정부에... 요청하는 여러 일들"). isManager이면 전체 목록+상태변경, 아니면(교사 등) 본인이
// 등록한 요청만 보고 새 요청을 등록합니다. isAdmin이면 카테고리 관리 패널도 함께 보입니다(요청:
// "사물함파손,물품구입 등을 관리자가 등록/편집할 수 있게").
export default async function StaffRequestsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  const isManager = isStaffOrAboveUser(me);

  const [{ data }, { data: categoriesData }, { data: usersData }] = await Promise.all([
    supabase.from("staff_requests").select("*").order("created_at", { ascending: false }).limit(300),
    supabase.from("staff_request_categories").select("*").order("sort_order", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved"),
  ]);

  // 요청을 완료 처리한 사람(resolved_by, 이메일)을 이름으로 보여주기 위한 매핑입니다(요청:
  // "그 업무를 완료에 넣은 사람을 트래킹해서 교사가 보는 진행상황에... 알 수 있게").
  const staffNames: Record<string, string> = {};
  for (const u of (usersData as { email: string; name: string | null }[] | null) ?? []) {
    if (u.name) staffNames[u.email] = u.name;
  }

  return (
    <StaffRequestsClient
      initialItems={(data as StaffRequest[]) ?? []}
      initialCategories={(categoriesData as StaffRequestCategoryRow[]) ?? []}
      isManager={isManager}
      myEmail={me?.email ?? ""}
      staffNames={staffNames}
    />
  );
}
