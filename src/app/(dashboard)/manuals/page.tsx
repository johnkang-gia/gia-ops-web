import { createClient } from "@/lib/supabase/server";
import type { ManualSection } from "@/lib/types";
import ManualsClient from "@/components/manuals/ManualsClient";

export const dynamic = "force-dynamic";

export default async function ManualsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("manual_sections")
    .select("*")
    .order("target_doc", { ascending: true })
    .order("category", { ascending: true });

  return <ManualsClient initialItems={(data as ManualSection[]) ?? []} />;
}
