import { createClient } from "@/lib/supabase/server";
import type { Meeting } from "@/lib/types";
import MeetingsClient from "@/components/meetings/MeetingsClient";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meetings")
    .select("*")
    .order("date", { ascending: false })
    .limit(200);

  return <MeetingsClient initialItems={(data as Meeting[]) ?? []} />;
}
