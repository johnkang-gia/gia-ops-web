import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { Incident } from "@/lib/types";
import IncidentsClient from "@/components/incidents/IncidentsClient";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const supabase = await createClient();
  const [{ data }, currentTerm, { data: { user } }] = await Promise.all([
    supabase.from("incidents").select("*").order("date", { ascending: false }).limit(200),
    getCurrentTerm(supabase),
    supabase.auth.getUser(),
  ]);

  return (
    <IncidentsClient
      initialItems={(data as Incident[]) ?? []}
      currentTerm={currentTerm}
      currentUserEmail={user?.email ?? ""}
    />
  );
}
