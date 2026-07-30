import { createClient } from "@/lib/supabase/server";
import type { Term } from "@/lib/types";
import TermsClient from "@/components/terms/TermsClient";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("terms")
    .select("*")
    .order("year", { ascending: false })
    .limit(200);

  return <TermsClient initialItems={(data as Term[]) ?? []} />;
}
