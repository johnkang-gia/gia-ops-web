import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { Meeting } from "@/lib/types";
import MeetingsClient from "@/components/meetings/MeetingsClient";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const supabase = await createClient();
  const [{ data }, currentTerm] = await Promise.all([
    supabase.from("meetings").select("*").order("date", { ascending: false }).limit(200),
    getCurrentTerm(),
  ]);

  return <MeetingsClient initialItems={(data as Meeting[]) ?? []} currentTerm={currentTerm} />;
}
