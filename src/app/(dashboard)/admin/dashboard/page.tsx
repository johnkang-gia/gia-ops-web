import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { AppUser, Department, Task, Term, WrReport, WrStudent } from "@/lib/types";
import StatCard from "@/components/admin/StatCard";
import GroupedBarChart, { type BarDataPoint } from "@/components/admin/GroupedBarChart";
import RankedList, { type RankedItem } from "@/components/admin/RankedList";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📊 관리자 대시보드란?",
    lines: [
      "업무 · 운영(사건·행사·회의) · 주간 학생 관찰기록 세 영역을 한 화면에서 확인합니다.",
      "반복되는 사건 유형과 반복적으로 지도가 필요한/우수한 학생을 자동으로 짚어주고, 최근 6개월 추이와 부서별 업무 완료율을 그래프로 보여줍니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

type IncidentRow = { date: string; manual_cat: string | null };
type DateRow = { date: string };

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// 최근 N개월(이번 달 포함)의 "YYYY-MM" 키와 "N월" 라벨 목록을 만듭니다.
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

// 현재 주(월~일)의 시작/끝 날짜를 구합니다.
function currentWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=일
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { start: toDateStr(monday), end: toDateStr(sunday) };
}

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const developer = isDeveloperEmail(me.email);
  if (!developer && me.position !== "관리자") redirect("/home");

  const months = lastMonths(6);
  const rangeStart = toDateStr(months[0].start);
  const { start: weekStart, end: weekEnd } = currentWeekRange();

  const [incidentsRes, eventsRes, meetingsRes, tasksRes, deptRes, appUsersRes, wrStudentsRes, wrTermRes, wrReportsRes] =
    await Promise.all([
      supabase.from("incidents").select("date, manual_cat").gte("date", rangeStart).order("date", { ascending: false }),
      supabase.from("events").select("date").gte("date", rangeStart),
      supabase.from("meetings").select("date").gte("date", rangeStart),
      supabase.from("tasks").select("id, status, department"),
      supabase.from("departments").select("*").order("sort_order", { ascending: true }),
      supabase.from("app_users").select("*").eq("status", "approved"),
      supabase.from("wr_students").select("id, name, status, class_name").eq("status", "active"),
      supabase.from("terms").select("*").eq("status", "진행중").order("start_date", { ascending: false }).limit(1).maybeSingle(),
      supabase
        .from("wr_reports")
        .select("id, student_id, term_id, eval_badges, status, report_date")
        .gte("report_date", rangeStart),
    ]);

  const incidents = (incidentsRes.data as IncidentRow[] | null) ?? [];
  const events = (eventsRes.data as DateRow[] | null) ?? [];
  const meetings = (meetingsRes.data as DateRow[] | null) ?? [];
  const tasks = (tasksRes.data as Task[] | null) ?? [];
  const departments = (deptRes.data as Department[] | null) ?? [];
  const appUsers = (appUsersRes.data as AppUser[] | null) ?? [];
  const wrStudents = (wrStudentsRes.data as WrStudent[] | null) ?? [];
  const wrTerm = wrTermRes.data as Term | null;
  const wrReports = (wrReportsRes.data as WrReport[] | null) ?? [];

  // ===== 1. 학교 전체 통계 (KPI) =====
  const last30 = toDateStr(new Date(Date.now() - 30 * 86400000));
  const incidents30 = incidents.filter((r) => r.date >= last30).length;
  const events30 = events.filter((r) => r.date >= last30).length;
  const meetings30 = meetings.filter((r) => r.date >= last30).length;

  const completedTasks = tasks.filter((t) => t.status === "완료").length;
  const taskCompletionRate = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;

  const studentIdToName = new Map(wrStudents.map((s) => [s.id, s.name]));
  const weekReports = wrReports.filter((r) => r.report_date >= weekStart && r.report_date <= weekEnd);
  const weekPublished = weekReports.filter((r) => r.status === "published");
  const weekReportedStudentIds = new Set(weekPublished.map((r) => r.student_id));
  const weeklyCoverage = wrStudents.length ? Math.round((weekReportedStudentIds.size / wrStudents.length) * 100) : 0;

  // ===== 2. 반복 사건 패턴 (최근 6개월, 3건 이상 반복된 유형) =====
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

  // ===== 3. 학생 평가(위클리 리포트) 현황 - 반복 부진/문제행동, 반복 우수 =====
  const badgeGroupedWarning = new Map<string, number>();
  const badgeGroupedExcellent = new Map<string, number>();
  const termReports = wrTerm ? wrReports.filter((r) => r.term_id === wrTerm.id) : wrReports;
  for (const r of termReports) {
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

  // ===== 4. 월별 추이 그래프 =====
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

  // ===== 5. 부서별 업무 완료율 =====
  const deptTrend: BarDataPoint[] = departments.map((d) => {
    const deptTasks = tasks.filter((t) => t.department === d.name);
    const rate = deptTasks.length ? Math.round((deptTasks.filter((t) => t.status === "완료").length / deptTasks.length) * 100) : 0;
    return { label: d.name, values: { rate } };
  });

  const staffByPosition = {
    관리자: appUsers.filter((u) => u.position === "관리자").length,
    행정직원: appUsers.filter((u) => u.position === "행정직원").length,
    교사: appUsers.filter((u) => u.position === "교사").length,
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">관리자 대시보드</h1>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">통합 현황</span>
        </div>
        <GuideButton title="관리자 대시보드 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-5 text-xs text-slate-500">
        업무 · 운영(사건·행사·회의) · 주간 학생 관찰기록 세 영역을 한 화면에서 확인합니다. 반복되는 사건 유형과 반복적으로
        지도가 필요한 학생을 자동으로 짚어드리고, 최근 6개월 추이를 그래프로 보여드립니다.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="최근 30일 사건" value={incidents30} accent="#dc2626" />
        <StatCard label="최근 30일 행사" value={events30} accent="#2563eb" />
        <StatCard label="최근 30일 회의" value={meetings30} accent="#0d9488" />
        <StatCard label="전체 업무 완료율" value={`${taskCompletionRate}%`} sub={`${completedTasks}/${tasks.length}건`} accent="#1e3a5f" />
        <StatCard label="재적 학생 수" value={wrStudents.length} accent="#7c3aed" />
        <StatCard label="이번주 평가 발행률" value={`${weeklyCoverage}%`} sub={`${weekReportedStudentIds.size}/${wrStudents.length}명`} accent="#c6a15b" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="관리자" value={staffByPosition.관리자} accent="#1e3a5f" />
        <StatCard label="행정직원" value={staffByPosition.행정직원} accent="#1e3a5f" />
        <StatCard label="교사" value={staffByPosition.교사} accent="#1e3a5f" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-bold text-slate-700">⚠️ 반복되는 사건 유형 (최근 6개월, 3건 이상)</h2>
          <p className="mb-3 text-[11px] text-slate-400">
            같은 유형의 사건이 반복되고 있는지 자동으로 짚어드립니다.{" "}
            <Link href="/records" className="text-blue-600 hover:underline">
              사건기록 바로가기 →
            </Link>
          </p>
          <RankedList items={recurringIncidents} color="#dc2626" emptyText="반복되는 사건 유형이 없습니다." />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-bold text-slate-700">🌱 학생 평가 현황 (반복 지도필요 / 반복 우수)</h2>
          <p className="mb-3 text-[11px] text-slate-400">
            {wrTerm ? `${wrTerm.year} ${wrTerm.term_type} 기준` : "진행중인 학기 없음"} · 경고/미흡 배지 3회 이상은 추가 조치, 우수 배지 3회
            이상은 보상을 검토해 주세요.{" "}
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
          <h2 className="mb-3 text-sm font-bold text-slate-700">📈 월별 운영 기록 추이 (사건·행사·회의)</h2>
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
          <h2 className="mb-3 text-sm font-bold text-slate-700">📈 월별 학생평가 배지 추이 (경고/미흡 · 우수)</h2>
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
        <h2 className="mb-1 text-sm font-bold text-slate-700">💼 부서별 업무 완료율</h2>
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
