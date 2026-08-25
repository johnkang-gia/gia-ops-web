import { createClient } from "@/lib/supabase/server";
import type { EventRecord } from "@/lib/types";
import EventsClient from "@/components/events/EventsClient";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .order("date", { ascending: false })
    .limit(200);

  return (
    <div className="p-4 sm:p-6">
      <EventsClient initialItems={(data as EventRecord[]) ?? []} />
    </div>
  );
}
