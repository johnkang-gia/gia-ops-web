import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDemoAccount } from "@/lib/sharedAccounts";
import TeacherOverviewClient, {
  type TeacherClass,
  type TtPeriod,
  type TtCell,
  type MyLesson,
  type TermRaw,
} from "@/components/teacher/TeacherOverviewClient";

export const dynamic = "force-dynamic";

// 교사 로그인 첫 화면(요청 3): 담임 선생님은 우리 반 개요(학년/반·학생 명단 위젯·우리 반 주간
// 시간표)를, 과목 선생님은 내 주간 시간표·시수·지금 무슨 시간(프랩/수업+장소)을 봅니다.
// 상단탭 고정으로 다른 교사 화면(주간 리포트·픽업·행정실 문의)으로 이동합니다.
function kstNow() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wd = wdMap[p.find((x) => x.type === "weekday")?.value ?? "Mon"] ?? 1;
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0");
  const m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  return { weekday: wd, minutes: h * 60 + m };
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").trim().toLowerCase();

export default async function MyClassPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const supabase = await createClient();
  const email = me.email;
  const demo = isDemoAccount(email);

  // 내 담임/부담임 반
  const { data: myClassRows } = await supabase
    .from("wr_classes")
    .select("id, grade, class_name, department, room, teacher_email, sub_teacher_email, teacher_name, sub_teacher_name, is_demo")
    .or(`teacher_email.eq.${email},sub_teacher_email.eq.${email}`)
    .eq("is_demo", demo);
  const myClasses = myClassRows ?? [];
  const isHomeroom = myClasses.length > 0;

  // 공통: 교시 + 시간표 + 반 목록(라벨/부서 해석용)
  const [{ data: periodsRaw }, { data: classesRaw }] = await Promise.all([
    supabase.from("wr_periods").select("id, department, period_no, label, start_time, end_time").order("start_time"),
    supabase.from("wr_classes").select("id, grade, class_name, department"),
  ]);
  const periods: TtPeriod[] = (periodsRaw ?? []).map((p) => ({
    id: p.id as string,
    department: (p.department as string) ?? "",
    periodNo: (p.period_no as number) ?? 0,
    label: (p.label as string | null) ?? `${p.period_no}교시`,
    start: ((p.start_time as string) ?? "").slice(0, 5),
    end: ((p.end_time as string) ?? "").slice(0, 5),
  }));
  const classById = new Map((classesRaw ?? []).map((c) => [c.id as string, c]));

  // 현재 학기(배너)
  const { data: termRows } = await supabase
    .from("terms")
    .select("term_type, year, start_date, end_date")
    .eq("status", "진행중")
    .order("start_date", { ascending: false })
    .limit(1);
  const trRaw = (termRows ?? [])[0] as { term_type?: string; year?: string; start_date?: string | null; end_date?: string | null } | undefined;
  const term: TermRaw | null = trRaw
    ? {
        termType: trRaw.term_type ?? null,
        year: trRaw.year ?? null,
        start: trRaw.start_date ?? null,
        end: trRaw.end_date ?? null,
        dday: trRaw.end_date ? Math.ceil((new Date(trRaw.end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null,
      }
    : null;

  const now = kstNow();

  let teacherClasses: TeacherClass[] = [];
  let myLessons: MyLesson[] = [];

  if (isHomeroom) {
    const classIds = myClasses.map((c) => c.id as string);
    // 우리 반 학생 명단
    const { data: studs } = await supabase
      .from("wr_students")
      .select("name, name_en, class_id, status")
      .in("class_id", classIds)
      .eq("is_demo", demo);
    const studentsByClass = new Map<string, string[]>();
    for (const s of studs ?? []) {
      const st = (s.status as string | null) ?? null;
      // 재학(active)만 - 보관(inactive)·전출예정 등은 명단에서 제외(요청: 명부 리셋).
      if (st !== "active" && st !== "재학") continue;
      const cid = s.class_id as string | null;
      if (!cid) continue;
      const arr = studentsByClass.get(cid) ?? [];
      arr.push((s.name as string) ?? (s.name_en as string) ?? "");
      studentsByClass.set(cid, arr);
    }
    // 우리 반 시간표
    const { data: tt } = await supabase
      .from("wr_timetable")
      .select("class_id, weekday, period_id, subject_name, teacher_name, room")
      .in("class_id", classIds);
    const cellsByClass = new Map<string, TtCell[]>();
    for (const t of tt ?? []) {
      const cid = t.class_id as string;
      const arr = cellsByClass.get(cid) ?? [];
      arr.push({
        weekday: (t.weekday as number) ?? 0,
        periodId: t.period_id as string,
        subject: (t.subject_name as string) ?? "",
        teacher: (t.teacher_name as string | null) ?? null,
        classLabel: null,
        room: (t.room as string | null) ?? null,
      });
      cellsByClass.set(cid, arr);
    }
    teacherClasses = myClasses.map((c) => ({
      grade: (c.grade as string | null) ?? "",
      className: (c.class_name as string | null) ?? "",
      department: (c.department as string | null) ?? "",
      room: (c.room as string | null) ?? null,
      teacher: (c.teacher_name as string | null) ?? null,
      subTeacher: (c.sub_teacher_name as string | null) ?? null,
      students: (studentsByClass.get(c.id as string) ?? []).sort((a, b) => a.localeCompare(b, "ko")),
      cells: cellsByClass.get(c.id as string) ?? [],
    }));
  } else {
    // 과목 선생님: 이름으로 내 시간표를 모읍니다(시간표에는 teacher_name만 있음).
    const { data: tt } = await supabase
      .from("wr_timetable")
      .select("class_id, weekday, period_id, subject_name, teacher_name, room");
    const myName = norm(me.name);
    myLessons = (tt ?? [])
      .filter((t) => myName && norm(t.teacher_name as string | null) === myName)
      .map((t) => {
        const c = classById.get(t.class_id as string);
        return {
          weekday: (t.weekday as number) ?? 0,
          periodId: t.period_id as string,
          subject: (t.subject_name as string) ?? "",
          classLabel: c ? `${c.grade ?? ""}${c.class_name ?? ""}`.trim() : "",
          room: (t.room as string | null) ?? null,
        };
      });
  }

  return (
    <div className="p-4 sm:p-6">
      <TeacherOverviewClient
        isHomeroom={isHomeroom}
        teacherName={me.name ?? null}
        demo={demo}
        term={term}
        periods={periods}
        classes={teacherClasses}
        myLessons={myLessons}
        now={now}
      />
    </div>
  );
}
