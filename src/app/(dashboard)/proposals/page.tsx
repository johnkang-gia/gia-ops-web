import { createClient } from "@/lib/supabase/server";
import type { Proposal } from "@/lib/types";
import ProposalsClient from "@/components/proposals/ProposalsClient";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("proposals")
    .select("*")
    .eq("status", "검토대기")
    .order("date", { ascending: false })
    .limit(200);

  return <ProposalsClient initialItems={(data as Proposal[]) ?? []} />;
}
