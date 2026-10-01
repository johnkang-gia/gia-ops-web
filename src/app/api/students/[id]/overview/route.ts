import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess, isStaffOrAboveUser } from "@/lib/roles";
import { kstDateOffset, todayKst } from "@/lib/kst";
import { pickForWeek, weekStartOf } from "@/lib/dismissalWeek";
import { planLabel } from "@/lib/dismissalPlan";

/**
 * **학생 한 명의 요약** — 학생 창(StudentPanel)이 읽습니다.
 *
 * 프로필·회계 창·학생 하루판·관찰기록 프로필이 각자 다른 표를 읽고 있어서, 한 아이를 보려면
 * 창을 네 번 열었습니다. 여기서 기본·출결·픽업·기록을 한 번에 돌려주고, 돈은 회계 창이
 * 자기 API(`/api/finance/ledger/[id]`)로 따로 읽습니다 - 재무 권한이 없는 사람에게는 그 탭
 * 자체가 없습니다.
 *
 * 최근 30일만 읽습니다. 전체 이력은 프로필 화면(`/students/[id]`)이 보여줍니다.
 */
export const dynamic = "force-dynamic";

type DpRow = { weekday: number; kind: string; label: string | null; depart_time: string | null; note: string | null; week_start: string | null };

/** 요일마다 이번 주의 답 하나 - 「그 주만」이 「매주」를 이깁니다. 규칙은 dismissalWeek 의 것입니다. */
function dismissalThisWeek(rows: DpRow[], today: string): { weekday: number; mode: string; note: string | null }[] {
  const ws = weekStartOf(today);
  const out: { weekday: number; mode: string; note: string | null }[] = [];
  for (const wd of [1, 2, 3, 4, 5]) {
    const picked = pickForWeek(rows.filter((r) => r.weekday === wd), ws);
    if (picked) out.push({ weekday: wd, mode: planLabel(picked as Parameters<typeof planLabel>[0]), note: picked.note });
  }
  return out;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 교사도 엽니다 - 자기 반 아이 이름을 누르면 출결·픽업·기록이 보여야 합니다. 다만 보호자
  // 연락처는 행정실 이상에게만 돌려줍니다. 돈은 이 API 에 아예 없습니다.
  const staff = isStaffOrAboveUser(me);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const since = kstDateOffset(-30);
  const today = todayKst();

  const [stuRes, asgRes, attRes, pickRes, incRes, repRes, taskRes, dpRes] = await Promise.all([
    supabase
      .from("wr_students")
      .select("id, name, name_en, grade, class_name, department, status, birth_date, mother_phone, father_phone, parent_phone, photo_path")
      .eq("is_demo", false)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("shuttle_assignments")
      .select("id, weekdays, stop_id, shuttle_stops(seq, gate, route_id, shuttle_routes(route_no, name, direction, term, active))")
      .eq("student_id", id),
    supabase.from("attendance_records").select("date, status, note").eq("student_id", id).gte("date", since).order("date", { ascending: false }),
    supabase
      .from("pickup_requests")
      .select("id, kind, status, service_date, ai_pickup_time, summary, matched_name, answered_at")
      .eq("student_id", id)
      .gte("service_date", since)
      .order("service_date", { ascending: false })
      .limit(30),
    supabase.from("incident_students").select("incident_id, incidents(id, title, date, category)").eq("student_id", id).limit(10),
    supabase.from("wr_reports").select("id, report_date, term").eq("student_id", id).order("report_date", { ascending: false }).limit(5),
    supabase
      .from("tasks")
      .select("id, title, status, due_at, task_students!inner(student_id)")
      .eq("task_students.student_id", id)
      .is("deleted_at", null)
      .order("due_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase.from("student_dismissal_plans").select("weekday, kind, label, depart_time, note, week_start").eq("student_id", id),
  ]);

  if (stuRes.error) return NextResponse.json({ error: stuRes.error.message }, { status: 500 });
  if (!stuRes.data) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });

  const warnings: string[] = [];
  for (const [label, r] of [["셔틀", asgRes], ["출결", attRes], ["픽업", pickRes], ["사건", incRes], ["관찰기록", repRes], ["업무", taskRes], ["하원수단", dpRes]] as const) {
    if (r.error) warnings.push(`${label}: ${r.error.message}`);
  }

  type AsgRow = {
    id: string;
    weekdays: number[] | null;
    shuttle_stops: { seq: number; gate: string | null; route_id: string; shuttle_routes: { route_no: string; name: string | null; direction: string; term: string; active: boolean } | null } | null;
  };
  const shuttle = ((asgRes.data as unknown as AsgRow[] | null) ?? [])
    .filter((a) => a.shuttle_stops?.shuttle_routes)
    .map((a) => ({
      id: a.id,
      routeNo: a.shuttle_stops!.shuttle_routes!.route_no,
      routeName: a.shuttle_stops!.shuttle_routes!.name,
      direction: a.shuttle_stops!.shuttle_routes!.direction,
      term: a.shuttle_stops!.shuttle_routes!.term,
      active: a.shuttle_stops!.shuttle_routes!.active,
      stop: a.shuttle_stops!.gate,
      weekdays: a.weekdays ?? [],
    }));

  const att = (attRes.data as { date: string; status: string; note: string | null }[] | null) ?? [];
  const attSummary = { 결석: 0, 지각: 0, 조퇴: 0 };
  for (const a of att) if (a.status in attSummary) attSummary[a.status as keyof typeof attSummary] += 1;

  type IncRow = { incident_id: string; incidents: { id: string; title: string | null; date: string | null; category: string | null } | null };

  return NextResponse.json({
    today,
    since,
    canSeeFinance: hasFinanceAccess(me),
    student: staff ? stuRes.data : { ...stuRes.data, mother_phone: null, father_phone: null, parent_phone: null },
    shuttle,
    dismissal: dismissalThisWeek((dpRes.data as DpRow[] | null) ?? [], today),
    attendance: { summary: attSummary, rows: att.filter((a) => a.status !== "출석").slice(0, 20) },
    pickups: (pickRes.data as Record<string, unknown>[] | null) ?? [],
    incidents: ((incRes.data as unknown as IncRow[] | null) ?? []).map((r) => r.incidents).filter(Boolean),
    reports: (repRes.data as { id: string; report_date: string; term: string | null }[] | null) ?? [],
    tasks: ((taskRes.data as unknown as { id: string; title: string; status: string; due_at: string | null }[] | null) ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, due_at: t.due_at })),
    warnings,
  });
}
