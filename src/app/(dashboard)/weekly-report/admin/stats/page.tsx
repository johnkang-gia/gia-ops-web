import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getPeriodRange } from "@/lib/weeklyReport/week";
import type { Term, WrClass, WrReport } from "@/lib/types";
import RecordSearchPanel from "@/components/weeklyReport/admin/RecordSearchPanel";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📊 주간 학생 관찰기록 통계란?",
    lines: [
      "이번 작성기간(2주) 기준 재적 학생 수, 발행/임시저장 리포트 건수, 지도 필요·우수 평가 학생 수를 한눈에 확인합니다.",
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
    <div className="g-panel-solid p-4 text-center shadow-sm">
      <div className={"text-2xl font-extrabold " + tone}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

// 통계에 실제로 필요한 칸만. 본문(academic·improvement 등)은 길고 여기서 안 씁니다.
type WeekReportLite = { student_id: string; status: string; eval_badges: Record<string, string[]> | null };

const PAGE = 1000;

// 상한에 걸려 조용히 잘리지 않도록 끝까지 나눠 읽습니다.
async function fetchAllReports(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  termId: string,
  start: string,
  end: string
): Promise<{ data: WeekReportLite[] }> {
  const out: WeekReportLite[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("wr_reports")
      .select("student_id, status, eval_badges")
      .eq("term_id", termId)
      .gte("report_date", start)
      .lte("report_date", end)
      .order("student_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = (data as WeekReportLite[] | null) ?? [];
    out.push(...rows);
    // 한 장이 다 안 찼으면 마지막 장입니다.
    if (rows.length < PAGE) break;
    // 혹시 모를 무한 반복 방지(한 주에 5만 줄이 넘을 일은 없습니다).
    if (out.length >= 50000) break;
  }
  return { data: out };
}

export default async function WeeklyReportStatsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/weekly-report");

  const term = await getCurrentTerm();
  const { start, end } = getPeriodRange();

  const [{ count: activeStudentCount }, { data: weekReportsData }, { data: termsData }, { data: classesData }] =
    await Promise.all([
      supabase.from("wr_students").select("id", { count: "exact", head: true }).eq("is_demo", false).eq("status", "active"),
      // 한 주치라도 137명 × 과목 수면 1,000줄을 훌쩍 넘습니다.
      //
      // Supabase는 한 번에 돌려주는 줄 수에 상한이 있어서(기본 1,000), `select("*")`로
      // 통째로 달라고 하면 **말없이 잘린 채로** 옵니다. 그러면 "이번주 발행됨" 숫자가
      // 조용히 실제보다 작게 나옵니다 - 틀렸다는 표시조차 없이.
      //
      // 그래서 ① 필요한 칸만 가져오고 ② 1,000줄씩 끝까지 나눠 읽습니다.
      // 담임 선생님들이 한꺼번에 쓰기 시작하는 다음 주부터 바로 걸릴 자리였습니다.
      term
        ? fetchAllReports(supabase, term.id, start, end)
        : Promise.resolve({ data: [] as WeekReportLite[] }),
      supabase.from("terms").select("*").order("year", { ascending: false }).order("start_date", { ascending: false }),
      supabase.from("wr_classes").select("*").eq("is_demo", false).order("grade", { ascending: true }).order("class_name", { ascending: true }),
    ]);

  const weekReports = (weekReportsData as WeekReportLite[] | null) ?? [];
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
        {term ? `현재 학기: ${term.year}년 ${term.term_type}` : "진행중인 학기가 없습니다."} · 이번 작성기간 2주 ({start} ~ {end}) 기준
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="재적 학생 수" value={activeStudentCount ?? 0} tone="text-slate-700" />
        <StatCard label="이번 기간 발행됨" value={published} tone="text-emerald-600" />
        <StatCard label="이번 기간 임시저장" value={draft} tone="text-amber-600" />
        <StatCard label="⚠️ 지도 필요 학생" value={warningStudentIds.size} tone="text-red-600" />
        <StatCard label="🌟 우수 평가 학생" value={excellentStudentIds.size} tone="text-indigo-600" />
        <StatCard label="이번 기간 작성 총합" value={weekReports.length} tone="text-slate-700" />
      </div>

      <p className="mb-6 mt-4 text-[11px] text-slate-400">
        &quot;지도 필요/우수 학생&quot;은 이번 작성기간(2주) 리포트 중 하나라도 해당 뱃지가 선택된 학생 수를 중복 없이 센 값입니다.
      </p>

      <RecordSearchPanel terms={(termsData as Term[] | null) ?? []} classes={(classesData as WrClass[] | null) ?? []} />
    </div>
  );
}
