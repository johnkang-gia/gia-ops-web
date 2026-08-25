import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import SchoolOverviewClient, {
  type GradeCount,
  type SchoolKpi,
  type SchoolEvent,
  type ClassRow,
  type DeptCount,
  type SubjectRow,
  type TermInfo,
} from "@/components/school/SchoolOverviewClient";

export const dynamic = "force-dynamic";

// 학교 개요 대시보드(요청 ①: 학교 메뉴를 개요+탭 구조로). 재적·학년 분포·반/담임·다가오는
// 학사일정·이번주 위클리 리포트를 한 화면에 시각화합니다.
export default async function SchoolOverviewPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const sinceWeek = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [{ data: students }, { data: classes }, { data: eventRows }, reportsRes, { data: appUsers }, { data: subjectRows }, { data: termRows }] =
    await Promise.all([
      supabase.from("wr_students").select("name, grade, status, class_name, department"),
      supabase.from("wr_classes").select("grade, class_name, teacher_email, teacher_name").order("grade").order("class_name"),
      supabase.from("events").select("date, name").gte("date", today).order("date", { ascending: true }).limit(8),
      supabase.from("wr_reports").select("id", { count: "exact", head: true }).eq("status", "published").gte("report_date", sinceWeek),
      supabase.from("app_users").select("email, name").eq("status", "approved"),
      supabase.from("wr_subjects").select("name, teacher_email"),
      supabase.from("terms").select("term_type, year, start_date, end_date, status").eq("status", "진행중").order("start_date", { ascending: false }).limit(1),
    ]);
  const userNameByEmail = new Map((appUsers ?? []).map((u) => [u.email as string, (u.name as string | null) ?? null]));

  const isActive = (s: string | null) => s === "재학" || s === "active" || s === "재원" || s === "enrolled" || !s;
  const isGrad = (s: string | null) => s === "졸업" || s === "graduated";
  const isWithdrawn = (s: string | null) => s === "퇴학" || s === "전출" || s === "withdrawn";

  let active = 0, graduated = 0, withdrawn = 0;
  const gradeMap = new Map<string, number>();
  const classCount = new Map<string, number>(); // class_name -> 재학생 수
  const classStudents = new Map<string, string[]>(); // class_name -> 학생 이름들
  const deptMap = new Map<string, number>(); // 유치/초등/중고등
  const deptKey = (d: string) => (d.includes("유치") ? "유치부" : d.includes("초등") ? "초등부" : d.includes("중") || d.includes("고") ? "중고등부" : "기타");
  for (const s of students ?? []) {
    const st = (s.status as string | null) ?? null;
    if (isGrad(st)) graduated += 1;
    else if (isWithdrawn(st)) withdrawn += 1;
    else if (isActive(st)) {
      active += 1;
      const g = ((s.grade as string | null) ?? "미지정").trim() || "미지정";
      gradeMap.set(g, (gradeMap.get(g) ?? 0) + 1);
      const cn = ((s.class_name as string | null) ?? "").trim();
      if (cn) {
        classCount.set(cn, (classCount.get(cn) ?? 0) + 1);
        (classStudents.get(cn) ?? classStudents.set(cn, []).get(cn)!).push((s.name as string) ?? "");
      }
      const dep = ((s.department as string | null) ?? "").trim();
      const dk = dep ? deptKey(dep) : "기타";
      deptMap.set(dk, (deptMap.get(dk) ?? 0) + 1);
    }
  }
  const deptOrder = ["유치부", "초등부", "중고등부", "기타"];
  const deptCounts: DeptCount[] = deptOrder.filter((d) => deptMap.has(d)).map((dept) => ({ dept, count: deptMap.get(dept) ?? 0 }));
  const grades: GradeCount[] = [...gradeMap.entries()]
    .map(([grade, count]) => ({ grade, count }))
    .sort((a, b) => a.grade.localeCompare(b.grade, "ko", { numeric: true }));

  const classList = classes ?? [];
  const noHomeroom = classList.filter((c) => !c.teacher_email && !c.teacher_name).length;
  const classRows: ClassRow[] = classList.map((c) => {
    const email = (c.teacher_email as string | null) ?? null;
    const teacher = (email ? userNameByEmail.get(email) ?? null : null) ?? (c.teacher_name as string | null) ?? null;
    const cn = ((c.class_name as string | null) ?? "").trim();
    return {
      grade: (c.grade as string | null) ?? "",
      className: (c.class_name as string | null) ?? "",
      teacher,
      students: classCount.get(cn) ?? 0,
      studentNames: (classStudents.get(cn) ?? []).sort((a, b) => a.localeCompare(b, "ko")),
    };
  });

  // 과목 · 담당 선생님(요청: 어느 과목 선생님인지). 선생님 이름은 계정에서 해석합니다.
  const subjects: SubjectRow[] = (subjectRows ?? [])
    .map((s) => {
      const email = (s.teacher_email as string | null) ?? null;
      return { name: (s.name as string) ?? "", teacher: email ? userNameByEmail.get(email) ?? email : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  // 선생님 수(담임 + 과목 담당의 고유 인원). 이메일이 있으면 이메일로, 없으면 이름으로 셉니다.
  const teacherSet = new Set<string>();
  for (const c of classList) {
    if (c.teacher_email) teacherSet.add("e:" + (c.teacher_email as string));
    else if (c.teacher_name) teacherSet.add("n:" + (c.teacher_name as string));
  }
  for (const s of subjectRows ?? []) if (s.teacher_email) teacherSet.add("e:" + (s.teacher_email as string));
  const teacherCount = teacherSet.size;

  // 현재 학기 정보(요청: 지금 무슨 학기인지, 언제까지인지)
  const tr = (termRows ?? [])[0] as { term_type?: string; year?: string; start_date?: string | null; end_date?: string | null } | undefined;
  let term: TermInfo | null = null;
  if (tr) {
    const end = tr.end_date ? new Date(tr.end_date) : null;
    const dday = end ? Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
    term = {
      label: `${tr.year ?? ""} ${tr.term_type ?? ""}`.trim() || "진행 중인 학기",
      start: tr.start_date ?? null,
      end: tr.end_date ?? null,
      dday,
    };
  }

  const kpi: SchoolKpi = {
    active,
    graduated,
    withdrawn,
    classes: classList.length,
    noHomeroom,
    reportsThisWeek: reportsRes.count ?? 0,
  };
  const events: SchoolEvent[] = (eventRows ?? []).map((e) => ({ date: e.date as string, name: e.name as string }));
  const dateStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="p-4 sm:p-6">
      <SchoolOverviewClient
        kpi={kpi}
        grades={grades}
        events={events}
        classRows={classRows}
        deptCounts={deptCounts}
        subjects={subjects}
        teacherCount={teacherCount}
        term={term}
        date={dateStr}
      />
    </div>
  );
}
