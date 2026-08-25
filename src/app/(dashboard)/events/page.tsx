import { createClient } from "@/lib/supabase/server";
import type { EventRecord } from "@/lib/types";
import EventsClient from "@/components/events/EventsClient";
import DocsTabs from "@/components/documents/DocsTabs";

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
      <DocsTabs />
      <EventsClient initialItems={(data as EventRecord[]) ?? []} />
    </div>
  );
}
