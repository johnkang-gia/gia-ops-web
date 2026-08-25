import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { ManualSection, WrStudent } from "@/lib/types";
import StaffManualClient from "@/components/staff-manual/StaffManualClient";

export const dynamic = "force-dynamic";

export default async function StaffManualPage() {
  const supabase = await createClient();
  // 전화 응대 중 매뉴얼과 학생 정보를 한 화면에서 동시에 찾을 수 있도록, 재적 학생 명단도
  // 함께 내려줍니다(오른쪽 절반의 학생 검색용 - StudentQuickLookup).
  const [{ data }, { data: studentsData }, me] = await Promise.all([
    supabase.from("manual_sections").select("*").eq("target_doc", "실무자용").order("category", { ascending: true }),
    supabase.from("wr_students").select("*").eq("status", "active").order("name", { ascending: true }),
    getCurrentAppUser(),
  ]);

  return (
    <div className="h-full">
      <StaffManualClient
        initialItems={(data as ManualSection[]) ?? []}
        students={(studentsData as WrStudent[] | null) ?? []}
        currentUserEmail={me?.email ?? ""}
      />
    </div>
  );
}
