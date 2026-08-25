import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import SchoolOverviewClient, { type GradeCount, type SchoolKpi, type SchoolEvent } from "@/components/school/SchoolOverviewClient";

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

  const [{ data: students }, { data: classes }, { data: eventRows }, reportsRes] = await Promise.all([
    supabase.from("wr_students").select("grade, status"),
    supabase.from("wr_classes").select("teacher_email, teacher_name"),
    supabase.from("events").select("date, name").gte("date", today).order("date", { ascending: true }).limit(8),
    supabase.from("wr_reports").select("id", { count: "exact", head: true }).eq("status", "published").gte("report_date", sinceWeek),
  ]);

  const isActive = (s: string | null) => s === "재학" || s === "active" || s === "재원" || s === "enrolled" || !s;
  const isGrad = (s: string | null) => s === "졸업" || s === "graduated";
  const isWithdrawn = (s: string | null) => s === "퇴학" || s === "전출" || s === "withdrawn";

  let active = 0, graduated = 0, withdrawn = 0;
  const gradeMap = new Map<string, number>();
  for (const s of students ?? []) {
    const st = (s.status as string | null) ?? null;
    if (isGrad(st)) graduated += 1;
    else if (isWithdrawn(st)) withdrawn += 1;
    else if (isActive(st)) {
      active += 1;
      const g = ((s.grade as string | null) ?? "미지정").trim() || "미지정";
      gradeMap.set(g, (gradeMap.get(g) ?? 0) + 1);
    }
  }
  const grades: GradeCount[] = [...gradeMap.entries()]
    .map(([grade, count]) => ({ grade, count }))
    .sort((a, b) => a.grade.localeCompare(b.grade, "ko", { numeric: true }));

  const classList = classes ?? [];
  const noHomeroom = classList.filter((c) => !c.teacher_email && !c.teacher_name).length;

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
      <SchoolOverviewClient kpi={kpi} grades={grades} events={events} date={dateStr} />
    </div>
  );
}
