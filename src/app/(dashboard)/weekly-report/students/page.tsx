import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import type { WrClass, WrStudent } from "@/lib/types";
import TermClassOverviewClient from "@/components/weeklyReport/TermClassOverviewClient";

export const dynamic = "force-dynamic";

// 관리자/행정직원이 [주간 학생 관찰기록]에 들어왔을 때 첫 화면입니다. 예전에는 전교생을 한
// 표로만 보여줬는데, 지금은 현재 학기 + 반별 위젯(학생 리스트 + 작성 뱃지)으로 한눈에 진행
// 상황을 파악할 수 있도록 바꿨습니다(예전 표 형태 화면은 "전체 목록" 탭으로 그대로 남아있음).
export default async function StudentsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [{ data: studentsData }, { data: classesData }, term] = await Promise.all([
    supabase
      .from("wr_students")
      .select("*")
      .eq("status", "active")
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("wr_classes").select("*").order("grade", { ascending: true }).order("class_name", { ascending: true }),
    getCurrentTerm(supabase),
  ]);

  const students = (studentsData as WrStudent[] | null) ?? [];
  const classes = (classesData as WrClass[] | null) ?? [];

  // 담임/부담임 이메일 → 이름 표시를 위해 한 번에 조회합니다.
  const teacherEmails = [...new Set(classes.map((c) => c.teacher_email).filter((x): x is string => !!x))];
  const { data: teachersData } = teacherEmails.length
    ? await supabase.from("app_users").select("email, name").in("email", teacherEmails)
    : { data: [] as { email: string; name: string | null }[] };
  const teacherName = new Map((teachersData ?? []).map((t) => [t.email, t.name || t.email]));

  const classGroups = classes.map((cls) => ({
    cls,
    teacherName: cls.teacher_email ? teacherName.get(cls.teacher_email) ?? cls.teacher_email : "",
    students: students.filter((s) => s.class_id === cls.id),
  }));
  const classIds = new Set(classes.map((c) => c.id));
  const unassigned = students.filter((s) => !s.class_id || !classIds.has(s.class_id));

  return (
    <TermClassOverviewClient
      term={term}
      classGroups={classGroups}
      unassigned={unassigned}
      allStudents={students}
      userEmail={me.email}
    />
  );
}
