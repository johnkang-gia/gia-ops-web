import { createClient } from "@/lib/supabase/server";
import type { Incident } from "@/lib/types";
import IncidentsClient from "@/components/incidents/IncidentsClient";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("incidents")
    .select("*")
    .order("date", { ascending: false })
    .limit(200);

  return <IncidentsClient initialItems={(data as Incident[]) ?? []} />;
}
