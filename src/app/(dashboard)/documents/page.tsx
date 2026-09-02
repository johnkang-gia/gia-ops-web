import { createClient } from "@/lib/supabase/server";
import { scopedTermId, termScoped } from "@/lib/termScope";
import type { SchoolDocument } from "@/lib/types";
import DocumentsClient from "@/components/documents/DocumentsClient";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const supabase = await createClient();
  // 지금 보고 있는 학기의 것만. 학기를 바꾸면 그 학기 것이 보입니다.
  const termId = await scopedTermId();
  const { data } = await termScoped(supabase.from("documents").select("*"), termId)
    .order("status", { ascending: true })
    .order("name", { ascending: true });

  return (
    <div className="p-4 sm:p-6">
      <DocumentsClient initialItems={(data as SchoolDocument[]) ?? []} />
    </div>
  );
}
