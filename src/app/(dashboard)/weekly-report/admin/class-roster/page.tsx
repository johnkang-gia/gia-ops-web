import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { WrClass } from "@/lib/types";
import ClassRosterBoard, { type BoardStudent } from "@/components/weeklyReport/admin/ClassRosterBoard";
import GuideButton from "@/components/common/GuideButton";

/**
 * 반 배정 — 아이를 어느 반에 넣을지.
 *
 * 반/담임 관리와 한 화면에 있었는데, 두 일은 성격이 다릅니다.
 *
 *   · **반을 만들고 담임을 붙이는 일**은 학기와 교사에 붙습니다. 학기가 바뀌면 통째로
 *     다시 짜고, 지난 학기 것은 그대로 떠서 보관합니다. 관리자가 학기 초에 한 번 합니다.
 *   · **아이를 반에 넣는 일**은 학생 명부를 고치는 일입니다(`wr_students.class_id`).
 *     전학·재배정으로 학기 중에도 수시로 생기고, 행정실이 합니다.
 *
 * 한 화면에 두면 학기 고르개가 위에 있는데 아래 배정판은 학기와 무관하게 지금 명부를
 * 고칩니다. 지난 학기를 골라 놓고 아이를 옮기면 **지금 명부가 바뀝니다.** 화면이 거짓말을
 * 하는 자리라서 갈랐습니다.
 */

const GUIDE_SECTIONS = [
  {
    title: "🧩 반 배정이란?",
    lines: [
      "아이를 어느 반에 넣을지 정합니다. 이름표를 끌어다 놓거나, 눌러서 고른 뒤 반을 누릅니다.",
      "옮기면 학생 명부에 바로 반영됩니다 — 반 이름·반 번호·학년을 함께 바꿉니다.",
      "반 자체를 만들거나 담임을 붙이는 것은 [반 · 시간표 → 반/담임]에서 합니다. 그쪽은 학기와 교사에 붙는 자료입니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function ClassRosterPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  // 명부와 같은 규칙입니다 - 보는 것은 교직원 모두, 고치는 것은 행정직원 이상.
  const canEdit = isStaffOrAboveUser(me);

  const [{ data: classesData }, stuRes] = await Promise.all([
    supabase
      .from("wr_classes")
      .select("*")
      .eq("is_demo", false)
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true }),
    // 반이 없는 아이도 함께 읽어야 '미배정' 칸이 채워집니다.
    supabase
      .from("wr_students_basic")
      .select("id, name, name_en, grade, class_name, class_id, gender")
      .eq("status", "active")
      .order("name"),
  ]);
  if (stuRes.error) console.error("[반 배정] 명단을 읽지 못했습니다:", stuRes.error.message);

  const boardStudents = (
    (stuRes.data as
      | {
          id: string;
          name: string;
          name_en: string | null;
          grade: string | null;
          class_name: string | null;
          class_id: string | null;
          gender: "남" | "여" | null;
        }[]
      | null) ?? []
  ).map<BoardStudent>((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.name_en,
    grade: s.grade,
    className: s.class_name,
    classId: s.class_id,
    gender: s.gender,
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">반 배정</h1>
        <GuideButton title="반 배정 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        아이를 어느 반에 넣을지 정합니다. 옮기면 <b>학생 명부에 바로 반영됩니다.</b> 반을 만들고 담임을 붙이는 것은{" "}
        <b>반 · 시간표 → 반/담임</b>에서 합니다.
      </p>

      <ClassRosterBoard classes={(classesData as WrClass[] | null) ?? []} initialStudents={boardStudents} canEdit={canEdit} />
    </div>
  );
}
