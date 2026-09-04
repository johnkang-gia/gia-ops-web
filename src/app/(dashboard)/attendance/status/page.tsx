import { redirect } from "next/navigation";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { departmentOf } from "@/lib/department";
import type { RegisterRecord } from "@/lib/attendanceRegister";
import type { WrClass, WrStudent } from "@/lib/types";
import StatusClient, { type StatusStudent } from "@/components/attendance/StatusClient";

export const dynamic = "force-dynamic";

// 출석현황.
//
// 오늘을 찍는 화면(/attendance)이 답하지 못하는 것을 답합니다 - **쌓인 뒤의 물음**입니다.
// "이번 달 우리 반 출석률이 몇인가", "언제부터 나빠졌나", "어느 학년이 유독 낮은가".
//
// 날짜별 그래프를 함께 두는 이유: 합계만 있으면 "언제부터" 를 알 수 없는데, 실제로 궁금한
// 것은 대개 그 시점입니다. 독감이 도는 주는 그래프에서 골짜기로 보입니다.

export default async function AttendanceStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; date?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const base = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKst();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : base.slice(0, 7);

  const supabase = await createClient();
  const teacherOnly = isTeacherOnly(me);

  const classesQuery = teacherOnly
    ? supabase
        .from("wr_classes")
        .select("*")
        .eq("is_demo", isDemoAccount(me.email))
        .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
    : supabase.from("wr_classes").select("*").eq("is_demo", isDemoAccount(me.email));

  const [{ data: classesData }, termRes, coverageRes] = await Promise.all([
    classesQuery.order("grade").order("class_name"),
    supabase.from("terms").select("id, year, term_type, start_date, end_date").eq("status", "진행중").limit(1),
    supabase.from("attendance_coverage").select("starts_on").eq("id", true).maybeSingle(),
  ]);
  const classes = (classesData as WrClass[] | null) ?? [];
  const term = ((termRes.data as { id: string; year: string; term_type: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0] ?? null;
  const coverageStart = (coverageRes.data as { starts_on: string | null } | null)?.starts_on ?? null;

  // 교사는 자기 반만, 그 외는 전교생.
  let studentsData: WrStudent[] | null = [];
  if (teacherOnly) {
    const ids = classes.map((c) => c.id);
    if (ids.length > 0) {
      const res = await supabase.from("wr_students_basic").select("*").in("class_id", ids).eq("status", "active").order("name");
      studentsData = res.data as WrStudent[] | null;
    }
  } else {
    const res = await supabase.from("wr_students_basic").select("*").eq("status", "active").order("name");
    studentsData = res.data as WrStudent[] | null;
  }
  const students = studentsData ?? [];

  // 두 기간을 함께 읽습니다.
  //   · 학기 전체 — 반·학년·학교 출석률과 학생별 집계
  //   · 이번 달   — 날짜별 표와 그래프
  // 학기만 읽고 화면에서 자르면 그 달 앞뒤의 수업일을 알 수 없어 날짜 칸이 비뚤어집니다.
  const termFrom = term?.start_date ?? `${month}-01`;
  const termTo = term?.end_date ?? `${month}-31`;

  const [dayRes, recRes] = await Promise.all([
    supabase.from("school_days").select("day, is_school_day").gte("day", termFrom).lte("day", termTo).order("day"),
    supabase
      .from("attendance_records")
      .select("student_id, date, status, reason_type, source, confirmed_by_human")
      .gte("date", termFrom)
      .lte("date", termTo),
  ]);
  // 달력 표가 아직 없어도(마이그레이션 전) 화면은 열려야 합니다. 그때는 수업일 0일로 떠서
  // 화면이 "달력이 비어 있습니다" 라고 말합니다.
  if (dayRes.error) console.error("[출석현황] 수업일 달력을 읽지 못했습니다:", dayRes.error.message);
  if (recRes.error) console.error("[출석현황] 출결을 읽지 못했습니다:", recRes.error.message);

  const allSchoolDays = ((dayRes.data as { day: string; is_school_day: boolean }[] | null) ?? [])
    .filter((d) => d.is_school_day)
    .map((d) => d.day)
    // 기록 시작일 앞은 통째로 뺍니다. 출석부를 쓰기 전 날짜를 세면 전원 출석으로 읽힙니다.
    .filter((d) => !coverageStart || d >= coverageStart);

  const rows: StatusStudent[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade ?? null,
    className: s.class_name ?? null,
    // 6학년은 중고등부입니다. 판정은 한 곳(departmentOf)만 씁니다.
    department: departmentOf({ department: s.department, grade: s.grade }) ?? "미분류",
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <StatusClient
        month={month}
        termLabel={term ? `${term.year} ${term.term_type}` : "학기 미지정"}
        students={rows}
        records={(recRes.data as RegisterRecord[] | null) ?? []}
        schoolDays={allSchoolDays}
        coverageStart={coverageStart}
      />
    </div>
  );
}
