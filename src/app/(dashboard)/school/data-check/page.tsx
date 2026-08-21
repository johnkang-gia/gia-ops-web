import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import DataCheckIssues, { type ImportIssue } from "@/components/school/DataCheckIssues";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "🩺 명부 점검이란?",
    lines: [
      "학교 명부(PDF·구글시트)를 앱에 넣을 때, 사람이 확인해야만 판단할 수 있는 상황이 생깁니다. 그런 건들을 여기에 모아둡니다.",
      "가장 흔한 경우는 동명이인입니다. 이름과 생년월일이 모두 같은 학생이 이미 있으면 어느 쪽인지 기계가 정할 수 없어서, 덮어쓰지 않고 여기에 남깁니다. 애매한 채로 덮어쓰면 다른 학생의 관찰기록·출결이 섞이는데 그건 되돌리기가 매우 어렵습니다.",
      "생년월일이 비어 있는 학생도 표시됩니다. 다음 학기 명부와 자동으로 이어지려면 생년월일이 필요합니다 - [학생 관리]에서 채워주세요.",
      "처리한 건은 [확인 완료]를 눌러 목록에서 내리면 됩니다. 기록은 남습니다.",
    ],
  },
  {
    title: "📊 위쪽 숫자는 무엇인가요?",
    lines: [
      "지금 앱에 들어 있는 학생·반·시간표·과목 수입니다. 명부를 넣은 직후 이 숫자가 기대한 값과 맞는지 확인하는 용도입니다.",
      "2026학년도 3학기 기준 예상값 - 초등부 재학생 100명, 반 8개, 시간표 280칸, 과목 16개.",
      "이번 명부는 초등부 명부라서, 명부에 없던 재학생은 중고등부로 옮겨 화면에서 빠졌습니다(지우지 않았습니다). 그 인원이 [중고등부 (화면 제외)]에 나옵니다 - 아래 목록에서 누가 옮겨졌는지 확인하고, 초등부 학생인데 명부에서 누락된 경우라면 [학생 관리]에서 부서를 되돌려주세요.",
      "숫자가 0이면 아직 데이터가 반영되지 않은 것입니다(자동 반영에 1~2분 걸립니다).",
    ],
  },
];

// 요청: "대시보드에서 확인 어떻게 할 수 있어?" - 명부를 넣은 뒤 (1) 제대로 들어갔는지,
// (2) 사람이 확인해야 할 게 남았는지를 Supabase를 열지 않고 앱 안에서 보는 화면입니다.
export default async function DataCheckPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const [studentsRes, leftRes, classesRes, timetableRes, subjectsRes, periodsRes, termRes, issuesRes, secondaryRes] =
    await Promise.all([
      supabase.from("wr_students").select("id", { count: "exact", head: true }).eq("status", "active").eq("is_demo", false).eq("department", "초등부"),
      supabase.from("wr_students").select("id", { count: "exact", head: true }).eq("status", "inactive").eq("is_demo", false),
      supabase.from("wr_classes").select("id", { count: "exact", head: true }).eq("is_demo", false).eq("department", "초등부"),
      supabase.from("wr_timetable").select("id", { count: "exact", head: true }),
      supabase.from("wr_subjects").select("id", { count: "exact", head: true }),
      supabase.from("wr_periods").select("id", { count: "exact", head: true }).eq("department", "초등부"),
      supabase.from("terms").select("term_type, year, start_date, end_date").eq("status", "진행중").order("start_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("wr_import_issues").select("*").order("resolved").order("created_at", { ascending: false }).limit(300),
      // 화면에서 빠져 있는 중고등부 재학생. 숫자가 0이 아니어야 정상이며, 명부에 없던 학생들이
      // 여기로 옮겨졌다는 뜻입니다.
      supabase.from("wr_students").select("id", { count: "exact", head: true }).eq("status", "active").eq("is_demo", false).eq("department", "중고등부"),
    ]);

  const term = termRes.data as { term_type: string; year: string; start_date: string | null; end_date: string | null } | null;
  const issues = (issuesRes.data as ImportIssue[] | null) ?? [];
  const openCount = issues.filter((i) => !i.resolved).length;

  const stats: { label: string; value: number | null; expected?: number; href?: string }[] = [
    { label: "재학생 (초등부)", value: studentsRes.count, expected: 100, href: "/weekly-report/admin/students" },
    { label: "중고등부 (화면 제외)", value: secondaryRes.count },
    { label: "퇴원·전출", value: leftRes.count, expected: 26 },
    { label: "반 (초등부)", value: classesRes.count, expected: 8, href: "/weekly-report/admin/classes" },
    { label: "교시 (초등부)", value: periodsRes.count, expected: 7, href: "/ops-board" },
    { label: "시간표 칸", value: timetableRes.count, expected: 280, href: "/ops-board" },
    { label: "과목", value: subjectsRes.count, expected: 16, href: "/weekly-report/admin/subjects" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🩺 명부 점검</h1>
        <GuideButton title="명부 점검 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-5 text-xs leading-relaxed text-slate-500">
        학교 명부를 앱에 넣은 결과를 확인하는 곳입니다. 아래 숫자가 기대한 값과 맞는지 보고, 사람이 판단해야 하는 건이 남아
        있으면 처리해주세요.
      </p>

      {/* 지금 들어 있는 데이터 */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-bold text-slate-800">지금 앱에 들어 있는 데이터</h2>
          {term && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              {term.year} {term.term_type}
              {term.start_date && term.end_date ? ` · ${term.start_date} ~ ${term.end_date}` : ""}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((s) => {
            const value = s.value ?? 0;
            // 기대값과 다르면 색으로 알려줍니다. 딱 맞으면 초록, 0이면 아직 반영 전(회색),
            // 그 외에는 "확인해보세요"라는 뜻의 주황입니다. 학생 수는 전학 등으로 달라질 수
            // 있어서 틀렸다고 단정하지 않고 눈에만 띄게 합니다.
            const tone =
              value === 0 ? "border-slate-200 bg-slate-50 text-slate-400"
              : s.expected === undefined || value === s.expected ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700";
            const inner = (
              <div className={"rounded-xl border p-3 " + tone}>
                <div className="text-[11px] font-semibold opacity-80">{s.label}</div>
                <div className="mt-0.5 text-2xl font-black tabular-nums">{value}</div>
                {s.expected !== undefined && value !== s.expected && (
                  <div className="text-[10px] opacity-80">{value === 0 ? "아직 반영 전" : `명부 기준 ${s.expected}`}</div>
                )}
              </div>
            );
            return s.href ? (
              <Link key={s.label} href={s.href} className="block transition hover:-translate-y-0.5">
                {inner}
              </Link>
            ) : (
              <div key={s.label}>{inner}</div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          칸을 누르면 해당 관리 화면으로 이동합니다. 숫자가 모두 0이면 아직 반영 전입니다 — 배포 직후라면 1~2분 뒤
          새로고침해보시고, 한참 지나도 0이면 <strong className="text-slate-500">자동 반영(GitHub Actions)이 실패한 것</strong>이니
          저장소의 <span className="font-mono">supabase/manual/</span> 폴더에 있는 SQL을 Supabase SQL Editor에 1 → 2 → 3 순서로
          붙여넣어 실행해주세요.
        </p>
      </div>

      {/* 확인이 필요한 건 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">확인이 필요한 건</h2>
          {openCount > 0 ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{openCount}건</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">없음</span>
          )}
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
          동명이인이거나 이름은 같은데 생년월일이 다른 경우처럼, 기계가 판단하면 다른 학생의 기록이 섞일 수 있는 건들입니다.
          덮어쓰지 않고 여기에 남겨둡니다.
        </p>
        <DataCheckIssues initialIssues={issues} />
      </div>
    </div>
  );
}
