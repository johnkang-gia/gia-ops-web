import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 안내보드(로그인 없음) 전용 읽기 API - 로비/복도 화면은 개인 계정 세션이 없으므로,
// shuttle_board_links.token(추측 불가능한 uuid)만으로 인증하고 service role로 조회합니다.
// 파일럿 체크인/과거 학부모 테스트 API와 같은 패턴입니다. 하원 노선만 대상으로 합니다
// (요청: "등원은 패스하고 하원만 진행"). 링크가 가진 term(정규학기/여름캠프2)과 같은 노선만
// 보여줍니다(요청: "지금데이터는 정규학기에 사용할예정으로 분류해주고... 여름캠프2 셔틀목록을
// 만들어줘" - 두 term이 안내보드에서 서로 섞이지 않도록). 예전에는 "파일럿(GPS) 링크가 켜진
// 노선만" 보여줬지만, 여름캠프처럼 GPS 없이 도착체크만 쓰는 노선도 보여야 하므로 term 일치
// 여부로 기준을 바꿨습니다.
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
    .select("label, youtube_video_id, term, enabled")
    .eq("token", token)
    .maybeSingle();
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", link.term)
    .order("sort_order");
  const routeIds = (routes ?? []).map((r) => r.id);
  if (routeIds.length === 0) {
    return NextResponse.json({ label: link.label, youtubeVideoId: link.youtube_video_id, routes: [] });
  }

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

  const payload = (routes ?? []).map((r) => ({
    routeId: r.id,
    routeNo: r.route_no,
    name: r.name,
    events: eventsByRoute[r.id] ?? [],
    roster: rosterByRoute[r.id] ?? [],
  }));

  return NextResponse.json({ label: link.label, youtubeVideoId: link.youtube_video_id, routes: payload });
}
