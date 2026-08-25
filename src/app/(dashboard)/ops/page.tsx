import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import type { Incident } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";
import WorkTabs from "@/components/work/WorkTabs";

const GUIDE_SECTIONS = [
  {
    title: "📋 등록사건목록이란?",
    lines: [
      "최근 등록된 사건을 날짜순으로 모아 개요까지 함께 보여주는 요약 화면입니다. [기록] 메뉴를 누르면 가장 먼저 열립니다.",
      "사건기록 화면은 하나씩 자세히 보고 쓰는 곳인 반면, 여기는 \"요즘 무슨 일이 있었지\"를 훑어보는 곳입니다.",
      "제목을 누르면 그 사건의 사건기록 화면으로 바로 이동합니다.",
      "개요가 비어 있는 사건은 회색으로 표시됩니다. 사건기록에서 개요를 채워주시면 여기에도 나타납니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// 사건 개요는 상세내용(detail)을 우선 쓰고, 비어 있으면 조치사항 → 잘된 점 순으로 대신
// 보여줍니다. 화면에서는 CSS(line-clamp)로 최대 5줄까지만 보이게 잘라 카드 높이를 맞춥니다
// (요청: "개요를 세줄에서 다섯줄 정도를 볼 수 있도록").
function summaryOf(it: Incident): string {
  return it.detail || it.resolution_note || it.good || "";
}

function fmtDateHeading(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const label = d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  if (same(d, today)) return `오늘 · ${label}`;
  if (same(d, yesterday)) return `어제 · ${label}`;
  return label;
}

// 운영관리 카테고리를 눌렀을 때 바로 열리는 대시보드입니다(요청: "운영관리를 눌렀을 때...
// 날짜기준으로 언제, 어떤 사건이 등록되었고, 개요를 세줄에서 다섯줄 정도를 볼 수 있도록").
// 사건기록 화면(/records)이 입력·편집용이라면, 이 화면은 "무슨 일이 있었는지" 훑어보는
// 읽기 전용 요약본입니다.
export default async function OpsDashboardPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 교사는 운영관리 메뉴 자체에 접근할 수 없습니다(다른 운영관리 화면과 같은 기준).
  if (isTeacherOnly(me)) redirect("/weekly-report");

  const { data } = await supabase
    .from("incidents")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(120);

  const incidents = (data as Incident[] | null) ?? [];

  // 날짜별로 묶습니다(최신 날짜가 위).
  const groups: { date: string; items: Incident[] }[] = [];
  for (const it of incidents) {
    const last = groups[groups.length - 1];
    if (last && last.date === it.date) last.items.push(it);
    else groups.push({ date: it.date, items: [it] });
  }

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden">
      <div className="shrink-0"><WorkTabs /></div>
      <div className="shrink-0 text-center">
        {/* 사이드바 "운영 관리" 옆에 상시로 떠 있던 숫자를 없앤 대신, 여기 제목 옆에 총 건수를
            표시합니다(요청 5). */}
        <h1 className="flex items-center justify-center gap-2 text-lg font-bold">
          등록사건목록
          <span className="ml-2 rounded-full bg-gia-gold-soft/40 px-2 py-0.5 align-middle text-xs font-semibold text-gia-navy">
            {incidents.length}건
          </span>
          <GuideButton title="등록사건목록 사용 가이드" sections={GUIDE_SECTIONS} />
        </h1>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          최근 등록된 사건을 날짜순으로 모아 개요까지 함께 보여줍니다. 제목을 누르면 사건기록 화면으로 이동합니다.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {groups.length === 0 && <p className="text-center text-sm text-slate-400">등록된 사건이 없습니다.</p>}
        {groups.map((g) => (
          <section key={g.date} className="mb-5">
            <div className="sticky top-0 z-10 mb-2 bg-[var(--shell-content-bg,#fff)]/90 py-1 backdrop-blur">
              <h2 className="text-sm font-bold text-slate-600">
                {fmtDateHeading(g.date)}
                <span className="ml-1.5 text-xs font-normal text-slate-400">{g.items.length}건</span>
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {g.items.map((it) => {
                const summary = summaryOf(it);
                return (
                  <Link
                    key={it.id}
                    href="/records"
                    className="block rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-gia-navy hover:shadow"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{it.title}</span>
                      {it.status && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          {it.status}
                        </span>
                      )}
                      {it.manual_cat && (
                        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
                          {it.manual_cat}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-slate-300">{it.case_id}</span>
                    </div>
                    {summary ? (
                      <p className="line-clamp-5 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{summary}</p>
                    ) : (
                      <p className="text-xs italic text-slate-300">개요가 아직 입력되지 않았습니다.</p>
                    )}
                    {(it.students || it.owner) && (
                      <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-slate-400">
                        {it.students && <span>👧 {it.students}</span>}
                        {it.owner && <span>✍️ {it.owner}</span>}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
