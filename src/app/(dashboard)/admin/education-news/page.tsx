import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { EducationNews } from "@/lib/types";
import EducationNewsClient from "@/components/admin/EducationNewsClient";

export const dynamic = "force-dynamic";

export default async function EducationNewsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/home");

  const { data } = await supabase
    .from("education_news")
    .select("*")
    .order("published_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);

  return <EducationNewsClient initialNews={(data as EducationNews[] | null) ?? []} />;
}
