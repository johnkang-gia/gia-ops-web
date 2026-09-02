import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import StudentPhotosClient from "@/components/students/StudentPhotosClient";
import type { PhotoStudent } from "@/lib/passportPhoto";

// 학생 사진 일괄 등록.
//
// 명부는 **원본 표**에서 읽습니다. 공용 뷰에는 사진 칸이 없습니다.

export const dynamic = "force-dynamic";

export default async function StudentPhotosPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  // 재적 판정을 **한 값으로만** 하지 않습니다. 이 표의 status 에는 `active` 와 `재학` 이
  // 섞여 있어서, 한쪽만 보면 명부가 통째로 비고 화면에서는 "명부에서 못 찾았습니다"가
  // 사진마다 뜹니다. 어느 쪽도 오류로 보이지 않는 종류의 실패입니다.
  const { data, error } = await supabase
    .from("wr_students")
    .select("id, name, name_en, grade, class_name, status, photo_path")
    .eq("is_demo", false)
    .in("status", ["active", "재학"])
    .order("grade")
    .order("name");
  if (error) console.error("[학생 사진] 명부를 읽지 못했습니다:", error.message);

  type Row = {
    id: string; name: string; name_en: string | null; grade: string | null;
    class_name: string | null; status: string | null; photo_path: string | null;
  };
  const rows = (data as Row[] | null) ?? [];
  const roster: PhotoStudent[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.name_en,
    gradeLabel: [s.grade ? `${s.grade}학년` : null, s.class_name].filter(Boolean).join(" "),
    className: s.class_name,
    grade: s.grade,
  }));

  return (
    <StudentPhotosClient
      roster={roster}
      hasPhoto={rows.filter((s) => s.photo_path).map((s) => s.id)}
      currentUserEmail={me.email}
    />
  );
}
