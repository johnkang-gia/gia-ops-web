import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { GiaSystem } from "@/lib/types";
import GiaSystemsClient from "@/components/admin/GiaSystemsClient";

export const dynamic = "force-dynamic";

export default async function GiaSystemsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 편집 권한이 관리자→관리자+행정직원으로 넓어졌습니다(요청: "관리자·행정직원까지").
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const { data } = await supabase
    .from("gia_systems")
    .select("*")
    .order("major", { ascending: true })
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  return <GiaSystemsClient initialSystems={(data as GiaSystem[] | null) ?? []} />;
}
