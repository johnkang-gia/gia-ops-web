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
    // **목록에 쓰는 칸만** 가져옵니다. `*` 로 받으면 주소·보호자 연락처·특이사항까지
    // 전부 브라우저로 실려 오는데, 목록은 이름·학년·반으로 찾는 것이 전부입니다.
    // 자세한 내용은 학생을 고른 뒤 `/api/students/[id]` 가 따로 가져오므로 화면은 그대로입니다.
    // 안 쓰는 개인정보를 브라우저까지 보내는 것은 느린 것보다 나쁩니다.
    supabase
      .from("wr_students")
      .select("id, name, name_en, grade, class_name, student_no, status, is_demo")
      .eq("is_demo", false)
      .eq("status", "active")
      .order("name", { ascending: true }),
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
