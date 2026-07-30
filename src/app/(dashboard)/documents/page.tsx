import { createClient } from "@/lib/supabase/server";
import type { SchoolDocument } from "@/lib/types";
import DocumentsClient from "@/components/documents/DocumentsClient";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .order("status", { ascending: true })
    .order("name", { ascending: true });

  return <DocumentsClient initialItems={(data as SchoolDocument[]) ?? []} />;
}
