import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail, isAdminUser } from "@/lib/roles";
import type { AppUser } from "@/lib/types";
import AdminUsersClient from "@/components/admin/AdminUsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  // 승인 처리 자체는 DB(RLS)가 최종적으로 막아주지만, 관리자가 아닌 사람이 화면에 들어와
  // 다른 사람들의 신청 내역을 구경하는 것 자체를 막기 위해 화면 단에서도 한 번 더 확인합니다.
  if (!isAdminUser(me)) {
    redirect("/home");
  }

  const { data } = await supabase
    .from("app_users")
    .select("*")
    .order("status", { ascending: true })
    .order("requested_at", { ascending: false });

  // 개발자 계정은 이 화면(및 화면을 보는 다른 관리자들)에게 존재 자체가 드러나지 않도록 아예
  // 목록에서 제외합니다 - 서버에서 걸러서 클라이언트로 데이터 자체를 내려보내지 않습니다.
  const users = ((data as AppUser[]) ?? []).filter((u) => !isDeveloperEmail(u.email));

  // 요청("개발자는 사용자관리에서 사용자의 이름,부서들을 바꿀 수 있도록") - 일반 관리자에게는
  // 이름/부서 편집 UI 자체를 숨기고, 개발자 계정에게만 노출합니다. 권한 미리보기 중에는(요청:
  // "그 권한에서만 볼 수 있는 화면으로") 실제 관리자가 보는 화면과 똑같아야 하므로 이 편집
  // 기능도 감춥니다.
  return <AdminUsersClient initialUsers={users} viewerIsDeveloper={isDeveloperEmail(me.email) && !me.previewOf} />;
}
