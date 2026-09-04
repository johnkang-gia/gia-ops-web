import { redirect } from "next/navigation";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { departmentOf } from "@/lib/department";
import { summarizeAll, syncEntriesIntoRegister, type RegisterRecord } from "@/lib/attendanceRegister";
import type { AttendanceRecord, WrClass, WrStudent } from "@/lib/types";
import type { SummaryRow } from "@/components/attendance/AttendanceSummaryPanel";
import AttendanceClient from "@/components/attendance/AttendanceClient";

export const dynamic = "force-dynamic";

// 출석부.
//
// 한 화면에서 두 가지를 합니다.
//   ① 오늘 찍기 - 담임이 학생별로 출석/지각/결석/조퇴를 누릅니다(예전부터 있던 화면).
//   ② 쌓인 현황 - 전체·학년·반·학생별 결석 일수와 출석률(이번에 만든 것).
//
// 나누지 않은 이유: 오늘을 찍는 사람과 학기를 보는 사람이 같은 사람입니다. 화면을 나누면
// 매일 여는 쪽만 쓰이고 나머지는 아무도 안 봅니다.
//
// 그리고 이 화면에 들어올 때 **토들·구글챗 연락에서 읽은 출결을 먼저 채웁니다.** 지금까지
// 학부모가 토들에 "내일 결석합니다" 를 써도 담임의 출석부는 비어 있었습니다. 같은 결석을 두
// 번 적거나, 아무도 안 적어 출석부에 구멍이 났습니다.

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const { date: dateParam } = await searchParams;
  // 세계표준시로 자르면 한국 오전 9시 전에는 어제가 나옵니다(CLAUDE.md 4항).
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKst();

  const supabase = await createClient();
  const teacherOnly = isTeacherOnly(me);

  // 연락에서 읽은 출결을 먼저 채웁니다. 사람이 정해둔 줄은 건드리지 않습니다.
  // 화면을 그리기 전에 해야 그 결과가 이번 조회에 함께 나옵니다.
  const sync = await syncEntriesIntoRegister(supabase, date);
  if (sync.error) console.error("[출석부] 연락에서 출결을 채우지 못했습니다:", sync.error);

  const classesQuery = teacherOnly
    ? supabase
        .from("wr_classes")
        .select("*").eq("is_demo", isDemoAccount(me.email))
        .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
    : supabase.from("wr_classes").select("*").eq("is_demo", isDemoAccount(me.email));

  const [{ data: classesData }, { data: usersData }, termRes, coverageRes] = await Promise.all([
    classesQuery.order("grade", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved"),
    // 지금 학기. 집계 기간이자 수업일 달력의 범위입니다.
    supabase.from("terms").select("id, year, term_type, start_date, end_date, status").eq("status", "진행중").limit(1),
    supabase.from("attendance_coverage").select("starts_on").eq("id", true).maybeSingle(),
  ]);
  const classes = (classesData as WrClass[] | null) ?? [];
  const term = ((termRes.data as { id: string; year: string; term_type: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0] ?? null;
  const coverageStart = (coverageRes.data as { starts_on: string | null } | null)?.starts_on ?? null;

  // 교사는 자기 반 학생만, 그 외(행정직원/관리자/개발자)는 재학중인 학생 전원을 봅니다.
  let studentsData: WrStudent[] | null = [];
  if (teacherOnly) {
    const classIds = classes.map((c) => c.id);
    if (classIds.length > 0) {
      const res = await supabase
        .from("wr_students_basic")
        .select("*")
        .in("class_id", classIds)
        .eq("status", "active")
        .order("name", { ascending: true });
      studentsData = res.data as WrStudent[] | null;
    }
  } else {
    const res = await supabase.from("wr_students_basic").select("*").eq("status", "active").order("name", { ascending: true });
    studentsData = res.data as WrStudent[] | null;
  }
  const students = studentsData ?? [];

  // 수업일 달력과 학기 전체 기록. 집계는 이 둘 위에서만 계산됩니다.
  //
  // 달력이 없으면 분모가 없어서 출석률이 안 나옵니다 - 그때는 화면이 "달력이 비어 있습니다"
  // 라고 말합니다. 조용히 0%로 그리면 사람은 출석률이 0인 줄 압니다.
  const from = term?.start_date ?? date.slice(0, 4) + "-01-01";
  const to = term?.end_date ?? date;
  const [dayRes, allRecRes, todayRecRes] = await Promise.all([
    supabase.from("school_days").select("day, is_school_day, closed_reason, label").gte("day", from).lte("day", to),
    supabase
      .from("attendance_records")
      .select("student_id, date, status, reason_type, source, confirmed_by_human")
      .gte("date", from)
      .lte("date", to),
    supabase.from("attendance_records").select("*").eq("date", date),
  ]);

  // 달력 표가 아직 없어도(마이그레이션 전) 화면은 열려야 합니다. 그때는 집계가 '자료 없음'
  // 으로만 뜹니다 - 화면이 통째로 안 열리는 것보다 낫습니다.
  if (dayRes.error) console.error("[출석부] 수업일 달력을 읽지 못했습니다:", dayRes.error.message);
  if (allRecRes.error) console.error("[출석부] 학기 출결을 읽지 못했습니다:", allRecRes.error.message);

  const days = (dayRes.data as { day: string; is_school_day: boolean; closed_reason: string | null; label: string | null }[] | null) ?? [];
  const schoolDayList = days.filter((d) => d.is_school_day).map((d) => d.day);
  const todayRow = days.find((d) => d.day === date);
  // 달력에 아직 없는 날은 '수업일이 아니다' 로 단정하지 않습니다. 달력을 안 만든 것뿐일 수
  // 있고, 그 상태에서 화면이 "쉬는 날" 이라고 하면 담임이 출결을 안 찍습니다.
  const isSchoolDay = todayRow ? todayRow.is_school_day : true;

  const records = (allRecRes.data as RegisterRecord[] | null) ?? [];
  const summaries = summarizeAll(students.map((s) => s.id), records, schoolDayList, coverageStart);
  const summaryRows: SummaryRow[] = students.map((s) => ({
    studentId: s.id,
    name: s.name,
    grade: s.grade ?? null,
    className: s.class_name ?? null,
    // 6학년은 중고등부입니다. 판정은 한 곳(departmentOf)만 씁니다.
    // 학년도 부서도 못 읽는 줄이 있어서(전입 직후 등) 그때는 '미분류' 로 둡니다 - 빈 값이면
    // 묶을 때 통째로 사라집니다.
    department: departmentOf({ department: s.department, grade: s.grade }) ?? "미분류",
    summary: summaries.get(s.id)!,
  }));

  const staffNames: Record<string, string> = {};
  for (const u of (usersData as { email: string; name: string | null }[] | null) ?? []) {
    if (u.name) staffNames[u.email] = u.name;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <AttendanceClient
        key={date}
        date={date}
        classes={classes}
        students={students}
        initialRecords={(todayRecRes.data as AttendanceRecord[] | null) ?? []}
        myEmail={me.email}
        myName={me.name ?? null}
        isTeacher={teacherOnly}
        staffNames={staffNames}
        summaryRows={summaryRows}
        termLabel={term ? `${term.year} ${term.term_type}` : "학기 미지정"}
        schoolDayCount={coverageStart ? schoolDayList.filter((d) => d >= coverageStart).length : schoolDayList.length}
        coverageStart={coverageStart}
        isSchoolDay={isSchoolDay}
        closedLabel={todayRow?.label ?? todayRow?.closed_reason ?? null}
        autoAdded={sync.added}
      />
    </div>
  );
}
