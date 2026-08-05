import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { Department, Task, WrReport } from "@/lib/types";
import StatCard from "@/components/admin/StatCard";
import GroupedBarChart, { type BarDataPoint } from "@/components/admin/GroupedBarChart";
import RankedList, { type RankedItem } from "@/components/admin/RankedList";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🏛️ 관리자 통합 대시보드란?",
    lines: [
      "업무 · 운영(사건·행사·회의) · 주간 학생 관찰기록 세 영역의 최근 추이를 한 화면에서 확인합니다.",
      "반복되는 사건 유형, 반복적으로 지도가 필요한/우수한 학생을 자동으로 짚어주고, 부서별 업무 완료율도 함께 보여줍니다. 관리자(개발자 포함)에게만 보입니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

type IncidentRow = { date: string; manual_cat: string | null };
type DateRow = { date: string };

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function lastMonths(n: number) {
  const now = new Date();
  const months: { key: string; label: string; start: Date; end: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: `${start.getMonth() + 1}월`, start, end });
  }
  return months;
}

function monthKeyOf(dateStr: string) {
  return dateStr.slice(0, 7);
}

function currentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { start: toDateStr(monday), end: toDateStr(sunday) };
}

// 관리자 전용 "학교의 현황을 한눈에 볼 수 있는" 통합 대시보드입니다(요청: "관리자 통합 대시보드가
// 없어졌어, 관리자 페이지에서 관리자만 볼 수 있게 해주고"). 반복 사건·학생 랭킹·월별 추이·부서별
// 완료율 분석은 한때 /school(학교 관리 대시보드)로 합쳤었는데, 관리자 전용 분석이 로스터 화면
// 맨 아래에 묻혀 찾기 어려웠으므로 다시 이 독립된 화면으로 분리했습니다. 학생/반/교직원 로스터
// 요약은 /school에 그대로 남아있고(행정직원도 볼 수 있어야 하므로), 여기는 관리자만 보는 운영
// 분석 지표에 집중합니다.
export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/school");

  const months = lastMonths(6);
  const rangeStart = toDateStr(months[0].start);
  const { start: weekStart, end: weekEnd } = currentWeekRange();

  const [
    { data: studentsData },
    incidentsRes,
    eventsRes,
    meetingsRes,
    tasksRes,
    deptRes,
    wrReportsRes,
  ] = await Promise.all([
    supabase.from("wr_students").select("id, name").eq("status", "active"),
    supabase.from("incidents").select("date, manual_cat").gte("date", rangeStart).order("date", { ascending: false }),
    supabase.from("events").select("date").gte("date", rangeStart),
    supabase.from("meetings").select("date").gte("date", rangeStart),
    supabase.from("tasks").select("id, status, department"),
    supabase.from("departments").select("*").order("sort_order", { ascending: true }),
    supabase.from("wr_reports").select("id, student_id, term_id, eval_badges, status, report_date").gte("report_date", rangeStart),
  ]);

  const students = (studentsData as { id: string; name: string }[] | null) ?? [];
  const incidents = (incidentsRes.data as IncidentRow[] | null) ?? [];
  const events = (eventsRes.data as DateRow[] | null) ?? [];
  const meetings = (meetingsRes.data as DateRow[] | null) ?? [];
  const tasks = (tasksRes.data as Task[] | null) ?? [];
  const departments = (deptRes.data as Department[] | null) ?? [];
  const wrReports = (wrReportsRes.data as WrReport[] | null) ?? [];

  const last30 = toDateStr(new Date(Date.now() - 30 * 86400000));
  const incidents30 = incidents.filter((r) => r.date >= last30).length;
  const events30 = events.filter((r) => r.date >= last30).length;
  const meetings30 = meetings.filter((r) => r.date >= last30).length;

  const completedTasks = tasks.filter((t) => t.status === "완료").length;
  const taskCompletionRate = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;

  const studentIdToName = new Map(students.map((s) => [s.id, s.name]));
  const weekReports = wrReports.filter((r) => r.report_date >= weekStart && r.report_date <= weekEnd);
  const weekPublished = weekReports.filter((r) => r.status === "published");
  const weekReportedStudentIds = new Set(weekPublished.map((r) => r.student_id));
  const weeklyCoverage = students.length ? Math.round((weekReportedStudentIds.size / students.length) * 100) : 0;

  const catGrouped = new Map<string, { count: number; latestDate: string }>();
  for (const row of incidents) {
    const key = (row.manual_cat ?? "").trim();
    if (!key) continue;
    const existing = catGrouped.get(key);
    if (existing) {
      existing.count += 1;
      if (row.date > existing.latestDate) existing.latestDate = row.date;
    } else {
      catGrouped.set(key, { count: 1, latestDate: row.date });
    }
  }
  const recurringIncidents: RankedItem[] = Array.from(catGrouped.entries())
    .map(([label, v]) => ({ label, count: v.count, sub: `최근 발생일 ${v.latestDate}` }))
    .filter((p) => p.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const badgeGroupedWarning = new Map<string, number>();
  const badgeGroupedExcellent = new Map<string, number>();
  for (const r of wrReports) {
    const flat = Object.values(r.eval_badges ?? {}).flat();
    if (flat.includes("warning") || flat.includes("bad")) {
      badgeGroupedWarning.set(r.student_id, (badgeGroupedWarning.get(r.student_id) ?? 0) + 1);
    }
    if (flat.includes("excellent")) {
      badgeGroupedExcellent.set(r.student_id, (badgeGroupedExcellent.get(r.student_id) ?? 0) + 1);
    }
  }
  const needsAttention: RankedItem[] = Array.from(badgeGroupedWarning.entries())
    .filter(([, count]) => count >= 3)
    .map(([id, count]) => ({ label: studentIdToName.get(id) ?? "(알 수 없음)", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const consistentlyGood: RankedItem[] = Array.from(badgeGroupedExcellent.entries())
    .filter(([, count]) => count >= 3)
    .map(([id, count]) => ({ label: studentIdToName.get(id) ?? "(알 수 없음)", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const opsTrend: BarDataPoint[] = months.map((m) => ({
    label: m.label,
    values: {
      incidents: incidents.filter((r) => monthKeyOf(r.date) === m.key).length,
      events: events.filter((r) => monthKeyOf(r.date) === m.key).length,
      meetings: meetings.filter((r) => monthKeyOf(r.date) === m.key).length,
    },
  }));

  const evalTrend: BarDataPoint[] = months.map((m) => {
    const inMonth = wrReports.filter((r) => monthKeyOf(r.report_date) === m.key);
    let warning = 0;
    let excellent = 0;
    for (const r of inMonth) {
      const flat = Object.values(r.eval_badges ?? {}).flat();
      if (flat.includes("warning") || flat.includes("bad")) warning += 1;
      if (flat.includes("excellent")) excellent += 1;
    }
    return { label: m.label, values: { warning, excellent } };
  });

  const deptTrend: BarDataPoint[] = departments.map((d) => {
    const deptTasks = tasks.filter((t) => t.department === d.name);
    const rate = deptTasks.length ? Math.round((deptTasks.filter((t) => t.status === "완료").length / deptTasks.length) * 100) : 0;
    return { label: d.name, values: { rate } };
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🏛️ 관리자 통합 대시보드</h1>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/school"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            🏫 학교 관리(로스터) →
          </Link>
          <GuideButton title="관리자 통합 대시보드 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        업무 · 운영(사건·행사·회의) · 주간 학생 관찰기록 세 영역의 최근 추이를 확인합니다. 반복되는 사건
        유형과 반복적으로 지도가 필요한 학생을 자동으로 짚어드립니다. 관리자에게만 보입니다.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="최근 30일 사건" value={incidents30} accent="#dc2626" />
        <StatCard label="최근 30일 행사" value={events30} accent="#2563eb" />
        <StatCard label="최근 30일 회의" value={meetings30} accent="#0d9488" />
        <StatCard label="전체 업무 완료율" value={`${taskCompletionRate}%`} sub={`${completedTasks}/${tasks.length}건`} accent="#1e3a5f" />
        <StatCard label="이번주 평가 발행률" value={`${weeklyCoverage}%`} sub={`${weekReportedStudentIds.size}/${students.length}명`} accent="#c6a15b" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-bold text-slate-700">⚠️ 반복되는 사건 유형 (최근 6개월, 3건 이상)</h3>
          <p className="mb-3 text-[11px] text-slate-400">
            같은 유형의 사건이 반복되고 있는지 자동으로 짚어드립니다.{" "}
            <Link href="/records" className="text-blue-600 hover:underline">
              사건기록 바로가기 →
            </Link>
          </p>
          <RankedList items={recurringIncidents} color="#dc2626" emptyText="반복되는 사건 유형이 없습니다." />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-bold text-slate-700">🌱 학생 평가 현황 (반복 지도필요 / 반복 우수)</h3>
          <p className="mb-3 text-[11px] text-slate-400">
            최근 6개월 기준 · 경고/미흡 배지 3회 이상은 추가 조치, 우수 배지 3회 이상은 보상을 검토해
            주세요.{" "}
            <Link href="/weekly-report/admin/stats" className="text-blue-600 hover:underline">
              주간 학생 관찰기록 통계 →
            </Link>
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-red-500">⚠️ 반복 지도 필요</div>
              <RankedList items={needsAttention} color="#dc2626" emptyText="해당 학생이 없습니다." unit="회" />
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-emerald-600">🌟 반복 우수</div>
              <RankedList items={consistentlyGood} color="#10b981" emptyText="해당 학생이 없습니다." unit="회" />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">📈 월별 운영 기록 추이 (사건·행사·회의)</h3>
          <GroupedBarChart
            data={opsTrend}
            series={[
              { key: "incidents", label: "사건", color: "#dc2626" },
              { key: "events", label: "행사", color: "#2563eb" },
              { key: "meetings", label: "회의", color: "#0d9488" },
            ]}
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">📈 월별 학생평가 배지 추이 (경고/미흡 · 우수)</h3>
          <GroupedBarChart
            data={evalTrend}
            series={[
              { key: "warning", label: "경고/미흡", color: "#dc2626" },
              { key: "excellent", label: "우수", color: "#10b981" },
            ]}
          />
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-bold text-slate-700">💼 부서별 업무 완료율</h3>
        <p className="mb-3 text-[11px] text-slate-400">
          부서마다 등록된 전체 업무 대비 완료된 업무의 비율입니다.{" "}
          <Link href="/work" className="text-blue-600 hover:underline">
            업무 보드 바로가기 →
          </Link>
        </p>
        {deptTrend.length > 0 ? (
          <GroupedBarChart data={deptTrend} series={[{ key: "rate", label: "완료율", color: "#3b82f6" }]} maxValue={100} valueFormatter={(v) => `${v}%`} />
        ) : (
          <p className="text-xs text-slate-300">등록된 부서가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
