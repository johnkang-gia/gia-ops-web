import { redirect } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import WorkOverviewClient, { type ActionCard, type RecentItem } from "@/components/work/WorkOverviewClient";

export const dynamic = "force-dynamic";

// 업무 "개요 대시보드"(요청: 업무 메뉴만 띄워두고도 모든 상황을 확인·처리하는 관제탑). 오늘
// 확인·처리할 것(내게 배정된 업무·미답변 학부모 문의·선생님 행정실 요청·오늘 픽업·검토대기
// 제안·발행대기 채택)을 한 화면에 모으고, 업무 현황과 최근 기록을 함께 보여줍니다.
export default async function WorkOverviewPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (isTeacherOnly(me)) redirect("/weekly-report");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = url && key ? createAdminClient(url, key, { auth: { persistSession: false } }) : null;

  const today = new Date().toISOString().slice(0, 10);
  const num = (v: { count: number | null } | null | undefined) => v?.count ?? 0;

  let inquiryOpen = 0,
    officeOpen = 0,
    pickupToday = 0,
    proposalsPending = 0,
    adoptedPending = 0,
    myTasks = 0,
    chatToday = 0;
  let statusCounts: Record<string, number> = { 예정: 0, 진행중: 0, 보류: 0 };
  let completedToday = 0;
  const recents: { incidents: RecentItem[]; meetings: RecentItem[]; events: RecentItem[] } = { incidents: [], meetings: [], events: [] };
  let term: { label: string; dday: number | null } | null = null;

  if (supabase) {
    const [inqRes, offRes, pickRes, propRes, adoptRes, taskRes, chatRes, termRes, tasksAllRes, incRes, meetRes, evtRes] = await Promise.all([
      supabase.from("pickup_requests").select("id", { count: "exact", head: true }).neq("kind", "픽업").is("answered_at", null).eq("is_demo", false).neq("status", "무시"),
      supabase.from("teacher_office_requests").select("id", { count: "exact", head: true }).neq("status", "완료"),
      supabase.from("pickup_requests").select("id", { count: "exact", head: true }).eq("kind", "픽업").eq("service_date", today).eq("is_demo", false).neq("status", "무시"),
      supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "검토대기"),
      supabase.from("adopted").select("id", { count: "exact", head: true }).eq("publish", false),
      supabase.from("tasks").select("id", { count: "exact", head: true }).contains("assignee_emails", [me.email]).neq("status", "완료").is("archived_at", null).is("deleted_at", null),
      supabase.from("google_chat_mirror_messages").select("id", { count: "exact", head: true }).gte("created_at_google", today + "T00:00:00"),
      supabase.from("terms").select("term_type, year, end_date").eq("status", "진행중").order("start_date", { ascending: false }).limit(1),
      supabase.from("tasks").select("status, completed_at").is("archived_at", null).is("deleted_at", null),
      supabase.from("incidents").select("title, date").order("date", { ascending: false }).limit(5),
      supabase.from("meetings").select("content, date").order("date", { ascending: false }).limit(4),
      supabase.from("events").select("name, date").order("date", { ascending: false }).limit(4),
    ]);
    inquiryOpen = num(inqRes);
    officeOpen = num(offRes);
    pickupToday = num(pickRes);
    proposalsPending = num(propRes);
    adoptedPending = num(adoptRes);
    myTasks = num(taskRes);
    chatToday = num(chatRes);

    for (const t of (tasksAllRes.data as { status: string; completed_at: string | null }[] | null) ?? []) {
      if (t.status === "완료") {
        if ((t.completed_at ?? "").slice(0, 10) === today) completedToday += 1;
      } else if (statusCounts[t.status] != null) {
        statusCounts[t.status] += 1;
      }
    }

    recents.incidents = ((incRes.data as { title: string; date: string }[] | null) ?? []).map((r) => ({ label: r.title || "(제목 없음)", date: r.date }));
    recents.meetings = ((meetRes.data as { content: string; date: string }[] | null) ?? []).map((r) => ({ label: (r.content ?? "").slice(0, 40) || "(내용 없음)", date: r.date }));
    recents.events = ((evtRes.data as { name: string; date: string }[] | null) ?? []).map((r) => ({ label: r.name || "(이름 없음)", date: r.date }));

    const tr = (termRes.data ?? [])[0] as { term_type?: string; year?: string; end_date?: string | null } | undefined;
    if (tr) {
      term = {
        label: `${tr.year ?? ""} ${tr.term_type ?? ""}`.trim(),
        dday: tr.end_date ? Math.ceil((new Date(tr.end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null,
      };
    }
  }

  const actions: ActionCard[] = [
    { key: "mytasks", label: "내게 배정된 업무", count: myTasks, tone: "#2563eb", icon: "📌", href: "/work" },
    { key: "inquiry", label: "미답변 학부모 문의", count: inquiryOpen, tone: "#d97706", icon: "💬", href: "/inquiries" },
    { key: "office", label: "선생님 행정실 요청", count: officeOpen, tone: "#dc2626", icon: "❗", href: "/work" },
    { key: "pickup", label: "오늘 픽업 요청", count: pickupToday, tone: "#0ea5e9", icon: "🚗", href: "/pickup/inbox" },
    { key: "proposals", label: "검토대기 제안", count: proposalsPending, tone: "#7c3aed", icon: "📝", href: "/proposals" },
    { key: "adopted", label: "발행대기 채택", count: adoptedPending, tone: "#0d9488", icon: "📬", href: "/adopted" },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <WorkOverviewClient
        term={term}
        actions={actions}
        statusCounts={statusCounts}
        completedToday={completedToday}
        chatToday={chatToday}
        recents={recents}
      />
    </div>
  );
}
