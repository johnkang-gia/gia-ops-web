import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { Meeting, GiaSystem } from "@/lib/types";
import MeetingsClient from "@/components/meetings/MeetingsClient";
import DocsTabs from "@/components/documents/DocsTabs";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const supabase = await createClient();
  const [{ data }, currentTerm, { data: giaSystems }, me] = await Promise.all([
    supabase.from("meetings").select("*").order("date", { ascending: false }).limit(200),
    getCurrentTerm(),
    // 매뉴얼(실무자용)/운영계획안(학부모용) 항목 선택 드롭다운용 - GIA시스템(대분류>중분류>
    // 세부항목)에서 가져옵니다.
    supabase.from("gia_systems").select("*").order("major").order("category").order("name"),
    getCurrentAppUser(),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <DocsTabs />
      <MeetingsClient
      initialItems={(data as Meeting[]) ?? []}
      currentTerm={currentTerm}
      giaSystems={(giaSystems as GiaSystem[] | null) ?? []}
      currentUserEmail={me?.email ?? ""}
    />
    </div>  );
}
