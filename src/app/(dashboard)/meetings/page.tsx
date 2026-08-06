import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { Meeting, PolicyCategory } from "@/lib/types";
import MeetingsClient from "@/components/meetings/MeetingsClient";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const supabase = await createClient();
  const [{ data }, currentTerm, { data: policyCategories }, me] = await Promise.all([
    supabase.from("meetings").select("*").order("date", { ascending: false }).limit(200),
    getCurrentTerm(),
    // 매뉴얼(실무자용)/운영계획안(학부모용) 항목 선택 드롭다운용.
    supabase.from("policy_categories").select("*").order("target_doc").order("domain").order("sort_order"),
    getCurrentAppUser(),
  ]);

  return (
    <MeetingsClient
      initialItems={(data as Meeting[]) ?? []}
      currentTerm={currentTerm}
      policyCategories={(policyCategories as PolicyCategory[] | null) ?? []}
      currentUserEmail={me?.email ?? ""}
    />
  );
}
