import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import DateTimeCard from "@/components/home/DateTimeCard";
import type { Incident, Meeting, EventRecord, Term } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadHomeData() {
  const supabase = await createClient();

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().slice(0, 10);

  const [
    incidentsCount,
    eventsCount,
    meetingsCount,
    proposalsPendingCount,
    adoptedPendingCount,
    manualSectionsCount,
    recentIncidents,
    recentEvents,
    recentMeetings,
    recentIncidentsForPattern,
    currentTerm,
  ] = await Promise.all([
    supabase.from("incidents").select("id", { count: "exact", head: true }),
    supabase.from("events").select("id", { count: "exact", head: true }),
    supabase.from("meetings").select("id", { count: "exact", head: true }),
    supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "검토대기"),
    supabase.from("adopted").select("id", { count: "exact", head: true }).eq("publish", false),
    supabase.from("manual_sections").select("id", { count: "exact", head: true }),
    supabase
      .from("incidents")
      .select("id, case_id, date, title, status, created_at")
      .order("date", { ascending: false })
      .limit(6),
    supabase
      .from("events")
      .select("id, case_id, date, name, status, created_at")
      .order("date", { ascending: false })
      .limit(6),
    supabase
      .from("meetings")
      .select("id, case_id, date, content, status, created_at")
      .order("date", { ascending: false })
      .limit(6),
    supabase
      .from("incidents")
      .select("id, date, title, manual_cat")
      .not("manual_cat", "is", null)
      .gte("date", ninetyDaysAgoStr)
      .order("date", { ascending: false }),
    getCurrentTerm(supabase),
  ]);

  // AI 호출 없이 순수 집계만으로 "최근 90일 내 같은 유형 사건 반복" 여부를 찾습니다(비용 0).
  type PatternRow = { manual_cat: string; count: number; latestTitle: string; latestDate: string };
  const grouped = new Map<string, { count: number; latestTitle: string; latestDate: string }>();
  for (const row of (recentIncidentsForPattern.data as { date: string; title: string; manual_cat: string }[] | null) ?? []) {
    const key = row.manual_cat.trim();
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { count: 1, latestTitle: row.title, latestDate: row.date });
    }
  }
  const recurringPatterns: PatternRow[] = Array.from(grouped.entries())
    .map(([manual_cat, v]) => ({ manual_cat, ...v }))
    .filter((p) => p.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  type Activity = {
    key: string;
    icon: string;
    title: string;
    date: string;
    status: string | null;
    href: string;
  };

  const activity: Activity[] = [
    ...((recentIncidents.data as Pick<Incident, "id" | "case_id" | "date" | "title" | "status" | "created_at">[] | null) ?? []).map(
      (it) => ({
        key: `incidents-${it.id}`,
        icon: "📋",
        title: it.title,
        date: it.date,
        status: it.status,
        href: "/records",
      })
    ),
    ...((recentEvents.data as Pick<EventRecord, "id" | "case_id" | "date" | "name" | "status" | "created_at">[] | null) ?? []).map(
      (it) => ({
        key: `events-${it.id}`,
        icon: "🎉",
        title: it.name,
        date: it.date,
        status: it.status,
        href: "/events",
      })
    ),
    ...((recentMeetings.data as Pick<Meeting, "id" | "case_id" | "date" | "content" | "status" | "created_at">[] | null) ?? []).map(
      (it) => ({
        key: `meetings-${it.id}`,
        icon: "💬",
        title: it.content,
        date: it.date,
        status: it.status,
        href: "/meetings",
      })
    ),
  ]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 6);

  return {
    counts: {
      incidents: incidentsCount.count ?? 0,
      events: eventsCount.count ?? 0,
      meetings: meetingsCount.count ?? 0,
      proposalsPending: proposalsPendingCount.count ?? 0,
      adoptedPending: adoptedPendingCount.count ?? 0,
      manualSections: manualSectionsCount.count ?? 0,
    },
    activity,
    recurringPatterns,
    currentTerm: currentTerm as Term | null,
  };
}

function oneLine(text: string, maxLen = 42) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default async function HomePage() {
  const { counts, activity, recurringPatterns, currentTerm } = await loadHomeData();

  const recordCards = [
    { label: "📋 사건", value: counts.incidents, href: "/records" },
    { label: "🎉 행사", value: counts.events, href: "/events" },
    { label: "💬 회의", value: counts.meetings, href: "/meetings" },
  ];

  const workCards = [
    { label: "📝 제안함 대기", value: counts.proposalsPending, href: "/proposals", highlight: counts.proposalsPending > 0 },
    { label: "📬 채택예정 대기", value: counts.adoptedPending, href: "/adopted", highlight: counts.adoptedPending > 0 },
    { label: "📖 발행된 매뉴얼 항목", value: counts.manualSections, href: "/manuals", highlight: false },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-2 text-lg font-bold">홈</h1>

      {currentTerm && (
        <div className="mb-5 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-base font-bold text-white shadow-sm sm:text-lg">
            📅 {currentTerm.year} {currentTerm.term_type}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold text-slate-400">기록 현황</div>
          <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
            {recordCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm hover:border-slate-300 sm:p-4"
              >
                <div className="text-xl font-bold sm:text-2xl">{card.value}</div>
                <div className="mt-1 text-xs text-slate-500">{card.label}</div>
              </Link>
            ))}
          </div>

          <div className="mb-2 text-xs font-semibold text-slate-400">처리할 일</div>
          <div className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">
            {workCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className={
                  "rounded-xl border p-3 text-center shadow-sm sm:p-4 " +
                  (card.highlight
                    ? "border-amber-300 bg-amber-50 hover:border-amber-400"
                    : "border-slate-200 bg-white hover:border-slate-300")
                }
              >
                <div className={"text-xl font-bold sm:text-2xl " + (card.highlight ? "text-amber-700" : "")}>
                  {card.value}
                </div>
                <div className={"mt-1 text-xs " + (card.highlight ? "text-amber-700" : "text-slate-500")}>
                  {card.label}
                </div>
              </Link>
            ))}
          </div>

          {recurringPatterns.length > 0 && (
            <>
              <div className="mb-2 text-xs font-semibold text-amber-600">⚠️ 반복되는 사건 유형(최근 90일)</div>
              <div className="mb-8 flex flex-col gap-2">
                {recurringPatterns.map((p) => (
                  <Link
                    key={p.manual_cat}
                    href="/records"
                    className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm hover:border-amber-300"
                  >
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                      {p.count}건
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-amber-900">{p.manual_cat}</span>
                    <span className="hidden shrink-0 text-xs text-amber-600 sm:inline">
                      최근: {oneLine(p.latestTitle, 24)} ({p.latestDate})
                    </span>
                  </Link>
                ))}
                <p className="text-xs text-amber-700">
                  같은 유형의 사건이 반복되고 있어요 - 재발 방지를 위한 근본적인 대책(매뉴얼 반영)이 필요해 보입니다.
                </p>
              </div>
            </>
          )}

          <div className="mb-3 text-sm font-bold text-slate-700">최근 활동</div>
          <div className="flex flex-col gap-2">
            {activity.length === 0 && (
              <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
                최근 등록된 기록이 없습니다.
              </div>
            )}
            {activity.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                className="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm hover:bg-slate-50"
              >
                <span>{it.icon}</span>
                <span className="min-w-0 flex-1 truncate">{oneLine(it.title)}</span>
                <span className="shrink-0 text-xs text-slate-400">{it.date}</span>
                {it.status && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {it.status}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <DateTimeCard />
        </div>
      </div>
    </div>
  );
}
