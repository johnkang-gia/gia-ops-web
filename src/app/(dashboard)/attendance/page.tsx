import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import type { AttendanceRecord, WrClass, WrStudent } from "@/lib/types";
import AttendanceClient from "@/components/attendance/AttendanceClient";

export const dynamic = "force-dynamic";

// 오늘 날짜(한국 시간 기준)를 YYYY-MM-DD로 돌려줍니다. new Date().toISOString()은 UTC라
// 자정 근처에 하루가 밀릴 수 있어서(요청: "학생출석부를... 실시간 체크"), 반드시 Asia/Seoul
// 기준으로 계산합니다.
function todayKST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

// 학생 출석부 - 담임교사가 매일 학생별 출결을 실시간으로 체크하고(요청: "학생출석부를 교사가
// 실시간 체크할 수 있게"), 행정직원/관리자 등 다른 직원도 같은 화면을 실시간으로 보면서 결석한
// 학생의 보호자에게 바로 연락할 수 있는 화면입니다(요청: "다른권한의 교직원들도 그것을
// 실시간으로 보고 결석학생 보호자에게 연락할 수 있는"). 교사는 자기 담임/부담임 반만 보이고,
// 행정직원/관리자/개발자는 전체 반을 볼 수 있습니다(weekly-report/homeroom과 같은 기준).
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKST();

  const supabase = await createClient();
  const teacherOnly = isTeacherOnly(me);

  const classesQuery = teacherOnly
    ? supabase
        .from("wr_classes")
        .select("*")
        .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
    : supabase.from("wr_classes").select("*");

  const [{ data: classesData }, { data: usersData }] = await Promise.all([
    classesQuery.order("grade", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved"),
  ]);
  const classes = (classesData as WrClass[] | null) ?? [];

  // 교사는 자기 반 학생만, 그 외(행정직원/관리자/개발자)는 재학중인 학생 전원을 봅니다(아직
  // 반 배정이 안 된 학생도 놓치지 않도록 - AttendanceClient에서 "미배정"으로 따로 묶어 보여줍니다).
  let studentsData: WrStudent[] | null = [];
  if (teacherOnly) {
    const classIds = classes.map((c) => c.id);
    if (classIds.length > 0) {
      const res = await supabase
        .from("wr_students")
        .select("*")
        .in("class_id", classIds)
        .eq("status", "active")
        .order("name", { ascending: true });
      studentsData = res.data as WrStudent[] | null;
    }
  } else {
    const res = await supabase.from("wr_students").select("*").eq("status", "active").order("name", { ascending: true });
    studentsData = res.data as WrStudent[] | null;
  }

  // 그날 출결 기록은 전체를 한 번에 가져옵니다(학교 규모상 하루 전체 학생 수가 많지 않아 반별로
  // 나눠 조회할 필요가 없습니다) - RLS가 giamicro 승인 사용자에게 넓게 열려 있어 문제없습니다.
  const { data: recordsData } = await supabase.from("attendance_records").select("*").eq("date", date);

  const staffNames: Record<string, string> = {};
  for (const u of (usersData as { email: string; name: string | null }[] | null) ?? []) {
    if (u.name) staffNames[u.email] = u.name;
  }

  return (
    // 요청("출석부 공간 넓으니까 페이지 다섯열로 나눠서")에 맞춰 5열 그리드가 들어갈 자리를
    // 넉넉히 주기 위해 다른 화면(대부분 max-w-4xl~5xl)보다 넓게 잡습니다.
    <div className="mx-auto max-w-7xl">
      <AttendanceClient
        key={date}
        date={date}
        classes={classes}
        students={studentsData ?? []}
        initialRecords={(recordsData as AttendanceRecord[] | null) ?? []}
        myEmail={me.email}
        myName={me.name ?? null}
        isTeacher={teacherOnly}
        staffNames={staffNames}
      />
    </div>
  );
}
