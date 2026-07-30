import { createClient } from "@/lib/supabase/server";
import type { AppUser } from "@/lib/types";
import AdminUsersClient from "@/components/admin/AdminUsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_users")
    .select("*")
    .order("status", { ascending: true })
    .order("requested_at", { ascending: false });

  return <AdminUsersClient initialUsers={(data as AppUser[]) ?? []} />;
}
