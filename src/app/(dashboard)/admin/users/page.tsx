import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { AppUser } from "@/lib/types";
import AdminUsersClient from "@/components/admin/AdminUsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 승인 처리 자체는 DB(RLS)가 최종적으로 막아주지만, 관리자가 아닌 사람이 화면에 들어와
  // 다른 사람들의 신청 내역을 구경하는 것 자체를 막기 위해 화면 단에서도 한 번 더 확인합니다.
  if (!isDeveloperEmail(user.email)) {
    const { data: me } = await supabase
      .from("app_users")
      .select("position")
      .eq("email", (user.email ?? "").toLowerCase())
      .maybeSingle();
    if (me?.position !== "관리자") {
      redirect("/home");
    }
  }

  const { data } = await supabase
    .from("app_users")
    .select("*")
    .order("status", { ascending: true })
    .order("requested_at", { ascending: false });

  return <AdminUsersClient initialUsers={(data as AppUser[]) ?? []} />;
}
