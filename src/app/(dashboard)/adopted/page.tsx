import { createClient } from "@/lib/supabase/server";
import type { Adopted } from "@/lib/types";
import AdoptedClient from "@/components/adopted/AdoptedClient";

export const dynamic = "force-dynamic";

export default async function AdoptedPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("adopted")
    .select("*")
    .eq("publish", false)
    .order("date", { ascending: false })
    .limit(200);

  return <AdoptedClient initialItems={(data as Adopted[]) ?? []} />;
}
