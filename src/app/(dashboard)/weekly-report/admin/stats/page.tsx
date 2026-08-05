import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getWeekRange } from "@/lib/weeklyReport/week";
import type { Term, WrClass, WrReport } from "@/lib/types";
import RecordSearchPanel from "@/components/weeklyReport/admin/RecordSearchPanel";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📊 주간 학생 관찰기록 통계란?",
    lines: [
      "이번 주 기준 재적 학생 수, 발행/임시저장 리포트 건수, 지도 필요·우수 평가 학생 수를 한눈에 확인합니다.",
    ],
  },
  {
    title: "🔍 기록 검색",
    lines: ["연도-학기-학년-반을 조합해 과거 리포트를 검색할 수 있습니다."],
  },
];

export const dynamic = "force-dynamic";

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
      <div className={"text-2xl font-extrabold " + tone}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default async function WeeklyReportStatsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/weekly-report");

  const term = await getCurrentTerm();
  const { start, end } = getWeekRange();

  const [{ count: activeStudentCount }, { data: weekReportsData }, { data: termsData }, { data: classesData }] =
    await Promise.all([
      supabase.from("wr_students").select("id", { count: "exact", head: true }).eq("status", "active"),
      term
        ? supabase.from("wr_reports").select("*").eq("term_id", term.id).gte("report_date", start).lte("report_date", end)
        : Promise.resolve({ data: [] as WrReport[] }),
      supabase.from("terms").select("*").order("year", { ascending: false }).order("start_date", { ascending: false }),
      supabase.from("wr_classes").select("*").order("grade", { ascending: true }).order("class_name", { ascending: true }),
    ]);

  const weekReports = (weekReportsData as WrReport[] | null) ?? [];
  const published = weekReports.filter((r) => r.status === "published").length;
  const draft = weekReports.filter((r) => r.status === "draft").length;

  const warningStudentIds = new Set<string>();
  const excellentStudentIds = new Set<string>();
  for (const r of weekReports) {
    const all = Object.values(r.eval_badges ?? {}).flat();
    if (all.includes("warning") || all.includes("bad")) warningStudentIds.add(r.student_id);
    if (all.includes("excellent")) excellentStudentIds.add(r.student_id);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">주간 학생 관찰기록 통계</h1>
        <GuideButton title="주간 학생 관찰기록 통계 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {term ? `현재 학기: ${term.year}년 ${term.term_type}` : "진행중인 학기가 없습니다."} · 이번 주 ({start} ~ {end}) 기준
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="재적 학생 수" value={activeStudentCount ?? 0} tone="text-slate-700" />
        <StatCard label="이번주 발행됨" value={published} tone="text-emerald-600" />
        <StatCard label="이번주 임시저장" value={draft} tone="text-amber-600" />
        <StatCard label="⚠️ 지도 필요 학생" value={warningStudentIds.size} tone="text-red-600" />
        <StatCard label="🌟 우수 평가 학생" value={excellentStudentIds.size} tone="text-indigo-600" />
        <StatCard label="이번주 작성된 리포트 총합" value={weekReports.length} tone="text-slate-700" />
      </div>

      <p className="mb-6 mt-4 text-[11px] text-slate-400">
        &quot;지도 필요/우수 학생&quot;은 이번 주 리포트 중 하나라도 해당 뱃지가 선택된 학생 수를 중복 없이 센 값입니다.
      </p>

      <RecordSearchPanel terms={(termsData as Term[] | null) ?? []} classes={(classesData as WrClass[] | null) ?? []} />
    </div>
  );
}
