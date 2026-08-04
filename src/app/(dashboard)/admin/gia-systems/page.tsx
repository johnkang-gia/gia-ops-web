import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { GiaSystem } from "@/lib/types";
import GiaSystemsClient from "@/components/admin/GiaSystemsClient";

export const dynamic = "force-dynamic";

export default async function GiaSystemsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/home");

  const { data } = await supabase
    .from("gia_systems")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  return <GiaSystemsClient initialSystems={(data as GiaSystem[] | null) ?? []} />;
}
