import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { Incident } from "@/lib/types";
import IncidentsClient from "@/components/incidents/IncidentsClient";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const supabase = await createClient();
  const [{ data }, currentTerm, me] = await Promise.all([
    supabase.from("incidents").select("*").order("date", { ascending: false }).limit(200),
    getCurrentTerm(supabase),
    getCurrentAppUser(),
  ]);

  return (
    <IncidentsClient
      initialItems={(data as Incident[]) ?? []}
      currentTerm={currentTerm}
      currentUserEmail={me?.email ?? ""}
    />
  );
}
