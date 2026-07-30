import { createClient } from "@/lib/supabase/server";
import type { ManualSection } from "@/lib/types";
import StaffManualClient from "@/components/staff-manual/StaffManualClient";

export const dynamic = "force-dynamic";

export default async function StaffManualPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("manual_sections")
    .select("*")
    .eq("target_doc", "실무자용")
    .order("category", { ascending: true });

  return <StaffManualClient initialItems={(data as ManualSection[]) ?? []} />;
}
