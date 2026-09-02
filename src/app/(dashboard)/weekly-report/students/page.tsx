import { redirect } from "next/navigation";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { WrClass, WrStudent } from "@/lib/types";
import TermClassOverviewClient from "@/components/weeklyReport/TermClassOverviewClient";

export const dynamic = "force-dynamic";

// 관리자/행정직원이 [주간 학생 관찰기록]에 들어왔을 때 첫 화면입니다. 예전에는 전교생을 한
// 표로만 보여줬는데, 지금은 현재 학기 + 반별 위젯(학생 리스트 + 작성 뱃지)으로 한눈에 진행
// 상황을 파악할 수 있도록 바꿨습니다(예전 표 형태 화면은 "전체 목록" 탭으로 그대로 남아있음).
//
// 이 화면은 전교생 전체 반의 명단을 한 번에 보여주므로 행정직원 이상만 볼 수 있어야 합니다.
// 사이드바 메뉴에는 애초에 노출 안 되지만(교사는 메뉴 자체가 없음), 미들웨어는 /weekly-report/*
// 경로 전체를 교사에게 열어두기 때문에 주소를 직접 입력하면 들어와질 수 있어 여기서 한 번 더
// 막습니다 - 교사는 "내 담임반/내 담당과목"에서만 자기 반 학생을 볼 수 있습니다.
export default async function StudentsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/weekly-report/homeroom");

  const [{ data: studentsData }, { data: classesData }, term] = await Promise.all([
    supabase
      .from("wr_students")
      .select("*").eq("is_demo", isDemoAccount(me.email))
      .eq("status", "active")
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("wr_classes").select("*").eq("is_demo", isDemoAccount(me.email)).order("grade", { ascending: true }).order("class_name", { ascending: true }),
    getCurrentTerm(),
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
    // 계정(teacher_email)이 아직 연결 안 됐으면 임시로 적어둔 이름(teacher_name)을 대신 보여줍니다.
    teacherName: cls.teacher_email ? teacherName.get(cls.teacher_email) ?? cls.teacher_email : cls.teacher_name ?? "",
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
