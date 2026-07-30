import { createClient } from "@/lib/supabase/server";
import type { Incident, Meeting } from "@/lib/types";
import RecordsClient from "@/components/records/RecordsClient";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const supabase = await createClient();
  const [incidents, meetings] = await Promise.all([
    supabase.from("incidents").select("*").order("date", { ascending: false }).limit(200),
    supabase.from("meetings").select("*").order("date", { ascending: false }).limit(200),
  ]);

  return (
    <RecordsClient
      initialIncidents={(incidents.data as Incident[]) ?? []}
      initialMeetings={(meetings.data as Meeting[]) ?? []}
    />
  );
}
