import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isDeveloperEmail, isAdminUser, isStaffOrAboveUser } from "@/lib/roles";
import type { AppUser, Department, Task, WrClass, WrReport, WrStudent, WrSubject } from "@/lib/types";
import StatCard from "@/components/admin/StatCard";
import GroupedBarChart, { type BarDataPoint } from "@/components/admin/GroupedBarChart";
import RankedList, { type RankedItem } from "@/components/admin/RankedList";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🏛️ 학교 관리 대시보드란?",
    lines: [
      "현재 학기·개설된 반·과목·교사·교직원·재학생 현황을 한 화면에서 요약해서 보여줍니다.",
      "각 카드/목록의 '→' 링크를 누르면 해당 관리 화면(반 관리, 과목반 세팅, 사용자 관리, 학생 정보 조회)으로 바로 이동합니다.",
    ],
  },
  {
    title: "📥 구글시트로 가져오기",
    lines: ["관리자는 우상단 버튼으로 기존에 쓰던 구글시트의 학생/반 명단을 한 번에 불러와 초기 세팅을 빠르게 할 수 있습니다."],
  },
  {
    title: "📊 운영 분석 (관리자 전용)",
    lines: [
      "예전에는 이 분석 내용이 별도의 '관리자 대시보드' 화면에 따로 있었는데, 학교 관리 대시보드 하나로 합쳤습니다.",
      "반복되는 사건 유형, 반복적으로 지도가 필요한/우수한 학생을 자동으로 짚어주고, 최근 6개월 추이와 부서별 업무 완료율을 그래프로 보여줍니다. 관리자에게만 보입니다.",
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

// "학교 관리" 카테고리 자체를 눌렀을 때 나오는 한눈에 보기 대시보드입니다. 원래는 반/과목/
// 교직원/학생 현황(로스터)만 보여줬는데, 예전에 따로 있던 "관리자 대시보드"
// (반복 사건·학생 랭킹·월별 추이·부서별 완료율 분석)를 이 화면 하나로 합쳤습니다(요청: "중복되는
// 기능들을 통합, 최대한 하나로 통합할 수 있는것은 통합"). 두 화면이 따로 있으면 관리자가
// 전체 그림을 보려면 두 곳을 다 열어봐야 했는데, 이제 여기 한 곳에서 다 봅니다. 분석 섹션은
// 예전 관리자 대시보드와 동일하게 관리자(개발자 포함)에게만 보이고, 행정직원은 로스터
// 정보까지만 봅니다(기존 접근 권한 그대로 유지).
export default async function SchoolDashboardPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const isAdmin = isAdminUser(me);
  const isStaffOrAbove = isStaffOrAboveUser(me);
  if (!isStaffOrAbove) redirect("/home");

  const months = lastMonths(6);
  const rangeStart = toDateStr(months[0].start);
  const { start: weekStart, end: weekEnd } = currentWeekRange();

  const [
    currentTerm,
    { data: classesData },
    { data: subjectsData },
    { data: usersData },
    { data: studentsData },
    incidentsRes,
    eventsRes,
    meetingsRes,
    tasksRes,
    deptRes,
    wrReportsRes,
  ] = await Promise.all([
    getCurrentTerm(),
    supabase.from("wr_classes").select("*").order("grade", { ascending: true }).order("class_name", { ascending: true }),
    supabase.from("wr_subjects").select("*").order("name", { ascending: true }),
    supabase.from("app_users").select("*").eq("status", "approved").order("name", { ascending: true }),
    supabase.from("wr_students").select("*").eq("status", "active").order("grade", { ascending: true }).order("name", { ascending: true }),
    isAdmin
      ? supabase.from("incidents").select("date, manual_cat").gte("date", rangeStart).order("date", { ascending: false })
      : Promise.resolve({ data: [] as IncidentRow[] }),
    isAdmin ? supabase.from("events").select("date").gte("date", rangeStart) : Promise.resolve({ data: [] as DateRow[] }),
    isAdmin ? supabase.from("meetings").select("date").gte("date", rangeStart) : Promise.resolve({ data: [] as DateRow[] }),
    isAdmin ? supabase.from("tasks").select("id, status, department") : Promise.resolve({ data: [] as Task[] }),
    isAdmin ? supabase.from("departments").select("*").order("sort_order", { ascending: true }) : Promise.resolve({ data: [] as Department[] }),
    isAdmin
      ? supabase.from("wr_reports").select("id, student_id, term_id, eval_badges, status, report_date").gte("report_date", rangeStart)
      : Promise.resolve({ data: [] as WrReport[] }),
  ]);

  const classes = (classesData as WrClass[] | null) ?? [];
  const subjects = (subjectsData as WrSubject[] | null) ?? [];
  const users = (usersData as AppUser[] | null) ?? [];
  const students = (studentsData as WrStudent[] | null) ?? [];

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const teachers = users.filter((u) => !isDeveloperEmail(u.email) && u.position === "교사");
  // 개발자 계정은 다른 관리자들에게 존재 자체가 드러나지 않도록 교직원 리스트/카운트에서도
  // 완전히 제외합니다.
  const staff = users.filter(
    (u) => !isDeveloperEmail(u.email) && (u.position === "관리자" || u.position === "행정직원")
  );

  // ===== 아래부터는 관리자 전용 분석 (예전 /admin/dashboard) =====
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
  const termReports = currentTerm ? wrReports.filter((r) => r.term_id === currentTerm.id) : wrReports;
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
        <h1 className="text-lg font-bold">🏛️ 학교 관리 대시보드</h1>
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin && (
            <Link
              href="/school/import"
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              📥 구글시트로 가져오기
            </Link>
          )}
          <GuideButton title="학교 관리 대시보드 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">현재 학기·반·과목·교직원·학생 현황을 한눈에 확인합니다.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* 연도는 항상 나오니 작게 위에, 학기(여름캠프 등)는 줄바꿈해서 가운데에 크게 보여줍니다. */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          {currentTerm ? (
            <>
              <div className="text-[11px] font-semibold text-slate-400">{currentTerm.year}</div>
              <div className="mt-1 break-keep text-lg font-bold leading-tight text-blue-600">{currentTerm.term_type}</div>
            </>
          ) : (
            <div className="text-sm font-semibold text-slate-300">진행중인 학기 없음</div>
          )}
        </div>
        <StatCard label="개설된 반" value={classes.length} sub="개" accent="#7c3aed" />
        <StatCard label="과목" value={subjects.length} sub="개" accent="#7c3aed" />
        <StatCard label="교사" value={teachers.length} sub="명" accent="#0d9488" />
        <StatCard label="교직원" value={staff.length} sub="명" accent="#0d9488" />
        <StatCard label="재학생" value={students.length} sub="명" accent="#1e3a5f" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 개설된 반 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🏫 개설된 반</h2>
            <Link href="/weekly-report/admin/classes" className="text-[11px] font-semibold text-blue-600 hover:underline">
              반 관리 →
            </Link>
          </div>
          {classes.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 반이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {classes.map((c) => (
                <li key={c.id} className="py-1.5">
                  <div className="text-xs font-semibold text-slate-700">
                    {c.grade}학년 {c.class_name}
                  </div>
                  <div className="mt-0.5 break-keep text-[11px] leading-snug text-slate-400">
                    담임 {c.teacher_email ? nameByEmail.get(c.teacher_email) ?? c.teacher_email : "미지정"}
                    {c.sub_teacher_email ? ` · 부담임 ${nameByEmail.get(c.sub_teacher_email) ?? c.sub_teacher_email}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 과목 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">📘 과목</h2>
            <Link href="/weekly-report/admin/subjects" className="text-[11px] font-semibold text-blue-600 hover:underline">
              과목반 세팅 →
            </Link>
          </div>
          {subjects.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 과목이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {subjects.map((s) => (
                <li key={s.id} className="py-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color || "#94a3b8" }} />
                    <span className="break-keep">{s.name}</span>
                  </div>
                  <div className="mt-0.5 break-keep text-[11px] leading-snug text-slate-400">
                    {s.teacher_email ? nameByEmail.get(s.teacher_email) ?? s.teacher_email : "담당 교사 미지정"} · 학생 {s.student_ids?.length ?? 0}명
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 교사 리스트 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🧑‍🏫 교사 리스트</h2>
            {isAdmin && (
              <Link href="/admin/users" className="text-[11px] font-semibold text-blue-600 hover:underline">
                사용자 관리 →
              </Link>
            )}
          </div>
          {teachers.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 교사가 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {teachers.map((t) => (
                <li
                  key={t.email}
                  className="max-w-full truncate rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700"
                >
                  {t.name || t.email}
                  {t.department && <span className="ml-1 text-teal-400">({t.department})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 교직원 리스트 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🗂️ 교직원 리스트</h2>
            {isAdmin && (
              <Link href="/admin/users" className="text-[11px] font-semibold text-blue-600 hover:underline">
                사용자 관리 →
              </Link>
            )}
          </div>
          {staff.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 교직원이 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {staff.map((u) => (
                <li
                  key={u.email}
                  className="max-w-full truncate rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                >
                  {u.name || u.email}
                  <span className="ml-1 text-slate-400">({u.position})</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 학생 리스트 (요약) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🎓 학생 리스트 ({students.length}명)</h2>
            <Link href="/students" className="text-[11px] font-semibold text-blue-600 hover:underline">
              학생 정보 조회 →
            </Link>
          </div>
          {students.length === 0 ? (
            <p className="text-xs text-slate-400">재학 중인 학생이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
              {students.slice(0, 24).map((s) => (
                <div key={s.id} className="min-w-0">
                  <div className="truncate text-xs font-medium leading-tight text-slate-700">{s.name}</div>
                  {s.name_en && (
                    <div className="truncate text-[11px] font-normal leading-tight text-slate-400">{s.name_en}</div>
                  )}
                  <div className="truncate text-[11px] leading-tight text-slate-400">
                    {s.grade}학년 {s.class_name}
                  </div>
                </div>
              ))}
              {students.length > 24 && (
                <div className="flex items-center text-xs font-semibold text-blue-600">+{students.length - 24}명 더보기 →</div>
              )}
            </div>
          )}
        </section>
      </div>

      {isAdmin && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2 border-t border-slate-200 pt-6">
            <h2 className="text-base font-bold text-slate-800">📊 운영 분석</h2>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">관리자 전용</span>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            업무 · 운영(사건·행사·회의) · 주간 학생 관찰기록 세 영역의 최근 추이를 확인합니다. 반복되는 사건 유형과
            반복적으로 지도가 필요한 학생을 자동으로 짚어드립니다.
          </p>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
                {currentTerm ? `${currentTerm.year} ${currentTerm.term_type} 기준` : "진행중인 학기 없음"} · 경고/미흡 배지 3회
                이상은 추가 조치, 우수 배지 3회 이상은 보상을 검토해 주세요.{" "}
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
      )}
    </div>
  );
}
