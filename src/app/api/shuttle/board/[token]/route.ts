import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 안내보드(로그인 없음) 전용 읽기 API - 로비/복도 화면은 개인 계정 세션이 없으므로,
// shuttle_board_links.token(추측 불가능한 uuid)만으로 인증하고 service role로 조회합니다.
// 파일럿 체크인/과거 학부모 테스트 API와 같은 패턴입니다. 하원 노선만 대상으로 합니다
// (요청: "등원은 패스하고 하원만 진행").
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link, error: linkError } = await supabase
    .from("shuttle_board_links")
    .select("label, youtube_video_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name")
    .eq("active", true)
    .eq("direction", "하원")
    .order("sort_order");
  const routeIds = (routes ?? []).map((r) => r.id);
  if (routeIds.length === 0) {
    return NextResponse.json({ label: link.label, youtubeVideoId: link.youtube_video_id, routes: [] });
  }

  const { data: pilots } = await supabase.from("shuttle_pilot_routes").select("route_id, enabled").in("route_id", routeIds);
  const pilotedRouteIds = new Set((pilots ?? []).filter((p) => p.enabled).map((p) => p.route_id));

  const today = new Date().toISOString().slice(0, 10);
  const todayWeekday = new Date().getDay();

  const { data: stops } = await supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds);
  const stopIds = (stops ?? []).map((s) => s.id);
  const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

  const { data: assignments } = stopIds.length
    ? await supabase.from("shuttle_assignments").select("id, stop_id, student_name_raw, weekdays").in("stop_id", stopIds)
    : { data: [] };
  const relevant = (assignments ?? []).filter((a) => (a.weekdays as number[]).includes(todayWeekday));
  const assignmentIds = relevant.map((a) => a.id);

  const [eventsRes, boardingsRes] = await Promise.all([
    supabase.from("shuttle_run_events").select("route_id, event, created_at").in("route_id", routeIds).eq("service_date", today).order("created_at", { ascending: true }),
    assignmentIds.length
      ? supabase.from("shuttle_boardings").select("assignment_id, status").eq("service_date", today).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] as { assignment_id: string; status: string }[] }),
  ]);

  const eventsByRoute: Record<string, { event: string; created_at: string }[]> = {};
  for (const e of eventsRes.data ?? []) {
    (eventsByRoute[e.route_id] ??= []).push({ event: e.event, created_at: e.created_at });
  }

  const boardingByAssignment = new Map((boardingsRes.data ?? []).map((b) => [b.assignment_id, b.status]));

  const rosterByRoute: Record<string, { studentName: string; status: string }[]> = {};
  for (const a of relevant) {
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    const list = rosterByRoute[stop.route_id] ?? (rosterByRoute[stop.route_id] = []);
    list.push({ studentName: a.student_name_raw, status: boardingByAssignment.get(a.id) ?? "예정" });
  }
  for (const key of Object.keys(rosterByRoute)) {
    rosterByRoute[key].sort((x, y) => x.studentName.localeCompare(y.studentName, "ko"));
  }

  const payload = (routes ?? [])
    .filter((r) => pilotedRouteIds.has(r.id))
    .map((r) => ({
      routeId: r.id,
      routeNo: r.route_no,
      name: r.name,
      events: eventsByRoute[r.id] ?? [],
      roster: rosterByRoute[r.id] ?? [],
    }));

  return NextResponse.json({ label: link.label, youtubeVideoId: link.youtube_video_id, routes: payload });
}
