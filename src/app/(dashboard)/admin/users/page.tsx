import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { AppUser } from "@/lib/types";
import AdminUsersClient from "@/components/admin/AdminUsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  // 승인 처리 자체는 DB(RLS)가 최종적으로 막아주지만, 관리자가 아닌 사람이 화면에 들어와
  // 다른 사람들의 신청 내역을 구경하는 것 자체를 막기 위해 화면 단에서도 한 번 더 확인합니다.
  if (!isDeveloperEmail(me.email) && me.position !== "관리자") {
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

  return <AdminUsersClient initialUsers={users} />;
}
