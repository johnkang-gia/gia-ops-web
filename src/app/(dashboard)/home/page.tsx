import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Incident, Meeting, EventRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadHomeData() {
  const supabase = await createClient();

  const [incidentsCount, eventsCount, meetingsCount, recentIncidents, recentEvents, recentMeetings] =
    await Promise.all([
      supabase.from("incidents").select("id", { count: "exact", head: true }),
      supabase.from("events").select("id", { count: "exact", head: true }),
      supabase.from("meetings").select("id", { count: "exact", head: true }),
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
    ]);

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
        href: "/incidents",
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
    },
    activity,
  };
}

function oneLine(text: string, maxLen = 42) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default async function HomePage() {
  const { counts, activity } = await loadHomeData();

  const statCards = [
    { label: "📋 사건", value: counts.incidents, href: "/incidents" },
    { label: "🎉 행사", value: counts.events, href: "/events" },
    { label: "💬 회의", value: counts.meetings, href: "/meetings" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-bold">홈</h1>

      <div className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">
        {statCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm hover:border-slate-300 sm:p-4"
          >
            <div className="text-xl font-bold sm:text-2xl">{card.value}</div>
            <div className="mt-1 text-xs text-slate-500">{card.label}</div>
          </Link>
        ))}
      </div>

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
  );
}
