import { createClient } from "@/lib/supabase/server";
import type { ManualDraft } from "@/lib/types";
import AiManualClient from "@/components/ai-manual/AiManualClient";

export const dynamic = "force-dynamic";

export default async function AiManualPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("manual_drafts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  return <AiManualClient initialItems={(data as ManualDraft[]) ?? []} />;
}
