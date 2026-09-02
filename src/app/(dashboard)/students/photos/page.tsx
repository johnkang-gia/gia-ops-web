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
  const { data, error } = await supabase
    .from("wr_students")
    .select("id, name, name_en, grade, class_name, photo_path")
    .eq("status", "active")
    .eq("is_demo", false)
    .order("grade")
    .order("name");
  if (error) console.error("[학생 사진] 명부를 읽지 못했습니다:", error.message);

  type Row = {
    id: string; name: string; name_en: string | null; grade: string | null;
    class_name: string | null; photo_path: string | null;
  };
  const rows = (data as Row[] | null) ?? [];
  const roster: PhotoStudent[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.name_en,
    gradeLabel: [s.grade ? `${s.grade}학년` : null, s.class_name].filter(Boolean).join(" "),
  }));

  return (
    <StudentPhotosClient
      roster={roster}
      hasPhoto={rows.filter((s) => s.photo_path).map((s) => s.id)}
      currentUserEmail={me.email}
    />
  );
}
