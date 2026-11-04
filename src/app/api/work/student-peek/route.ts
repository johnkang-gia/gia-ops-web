import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { loadStudent } from "@/lib/students";
import { todayKst } from "@/lib/kst";
import { effectiveRouteId, routeChoiceOf } from "@/lib/shuttleRoute";
import { loadDismissalForDay } from "@/lib/dismissalToday";
import { isoWeekday } from "@/lib/dismissalWeek";

export const dynamic = "force-dynamic";

/**
 * 학생 한 명 «바로 보기» — 문의 줄에서 이름을 누르면 뜨는 작은 창의 자료.
 *
 * 학부모 문의에 답하려면 그 아이가 몇 호차인지·오늘 어떻게 가는지·오늘 특이사항이 있는지를 보러 셔틀 화면,
 * 하원수단 화면, 오늘 학생 칸을 차례로 열었습니다. 셋을 한 번에 돌려줍니다. 읽기만 합니다.
 *
 * 호차는 공용 판정(`shuttleRoute`)으로 정합니다 - 계속 이동이 걸린 아이를 원래 차로 적으면 답이 틀립니다(CLAUDE.md §2-11).
 */
export async function GET(req: Request) {
  const me = await getCurrentAppUser();
  if (!me || !isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "학생 번호가 없습니다." }, { status: 400 });

  const supabase = await createClient();
  const { row: student, error: stuErr } = await loadStudent(supabase, id);
  if (stuErr) return NextResponse.json({ error: "명부를 읽지 못했습니다: " + stuErr }, { status: 500 });
  if (!student) return NextResponse.json({ error: "명부에 없는 학생입니다." }, { status: 404 });

  const today = todayKst();
  const weekday = isoWeekday(today);
  const problems: string[] = [];

  // ── 셔틀(등원·하원 배정) ───────────────────────────────────────────
  const { data: asgs, error: asgErr } = await supabase
    .from("shuttle_assignments")
    .select("stop_id, override_route_id, weekdays")
    .eq("student_id", id);
  if (asgErr) problems.push("셔틀 배정: " + asgErr.message);
  const stopIds = [...new Set(((asgs ?? []) as { stop_id: string | null }[]).map((a) => a.stop_id).filter(Boolean) as string[])];
  const { data: stops } = stopIds.length
    ? await supabase.from("shuttle_stops").select("id, route_id, address, stop_time").in("id", stopIds)
    : { data: [] as { id: string; route_id: string; address: string | null; stop_time: string | null }[] };
  const stopById = new Map(((stops ?? []) as { id: string; route_id: string; address: string | null; stop_time: string | null }[]).map((s) => [s.id, s]));
  const picks = ((asgs ?? []) as { stop_id: string | null; override_route_id: string | null; weekdays: number[] | null }[])
    .map((a) => {
      const stop = a.stop_id ? stopById.get(a.stop_id) : null;
      const routeId = stop
        ? effectiveRouteId(routeChoiceOf({ stopRouteId: stop.route_id, assignmentOverride: a.override_route_id }))
        : null;
      return { routeId, stopName: stop ? [stop.stop_time?.slice(0, 5), stop.address].filter(Boolean).join(" ") || null : null, weekdays: a.weekdays, moved: !!a.override_route_id };
    })
    .filter((p) => p.routeId);
  const routeIds = [...new Set(picks.map((p) => p.routeId as string))];
  const { data: routes } = routeIds.length
    ? await supabase.from("shuttle_routes").select("id, route_no, name, direction, active").in("id", routeIds)
    : { data: [] as { id: string; route_no: string | null; name: string | null; direction: string | null; active: boolean | null }[] };
  const routeById = new Map(
    ((routes ?? []) as { id: string; route_no: string | null; name: string | null; direction: string | null; active: boolean | null }[]).map((r) => [r.id, r]),
  );
  const shuttles = picks
    .map((p) => {
      const r = routeById.get(p.routeId as string);
      if (!r || r.active === false) return null;
      return {
        direction: r.direction ?? "",
        route: r.route_no ? (/^\d+$/.test(r.route_no) ? `${r.route_no}호` : r.route_no) : (r.name ?? "?"),
        stop: p.stopName,
        weekdays: p.weekdays,
        today: !p.weekdays || p.weekdays.length === 0 || p.weekdays.includes(weekday),
        moved: p.moved,
      };
    })
    .filter(Boolean);

  // ── 오늘 하원수단 ───────────────────────────────────────────────────
  const dis = await loadDismissalForDay(supabase, { dayIso: today, weekday, studentIds: [id] });
  if (dis.error) problems.push("하원수단: " + dis.error);
  const d = dis.byStudent.get(id) ?? null;

  // ── 오늘 특이사항 ───────────────────────────────────────────────────
  const { data: notes, error: noteErr } = await supabase
    .from("student_day_notes")
    .select("id, kind, content, at_time")
    .eq("student_id", id)
    .eq("on_date", today)
    .is("deleted_at", null)
    .limit(20);
  if (noteErr) problems.push("특이사항: " + noteErr.message);

  return NextResponse.json({
    ok: true,
    student: { id: student.id, name: student.name, grade: student.grade, class_name: student.class_name },
    shuttles,
    dismissal: d ? { kind: d.kind, label: d.label, time: d.depart_time, note: d.note } : null,
    notes: notes ?? [],
    problems,
  });
}
