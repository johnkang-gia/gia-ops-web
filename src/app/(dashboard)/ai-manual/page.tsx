import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { ManualDraft } from "@/lib/types";
import AiManualClient from "@/components/ai-manual/AiManualClient";

export const dynamic = "force-dynamic";

export default async function AiManualPage() {
  const supabase = await createClient();
  const [{ data }, me] = await Promise.all([
    supabase
      .from("manual_drafts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    getCurrentAppUser(),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <AiManualClient
      initialItems={(data as ManualDraft[]) ?? []}
      currentUserEmail={me?.email ?? ""}
    />
    </div>  );
}
