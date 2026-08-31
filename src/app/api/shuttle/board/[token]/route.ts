import { NextResponse } from "next/server";
import { todayKst } from "@/lib/kst";
import { isUndecidedChoice } from "@/lib/shuttleChoice";
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

  const today = todayKst();
  const todayWeekday = new Date().getDay();

  // run_events는 routeIds만 있으면 바로 조회할 수 있어 stops와 무관하므로, stops 조회와
  // 동시에 시작합니다(요청: "실시간 반영 속도 더 개선") - 안내보드는 3초마다 폴링해서, 왕복을
  // 하나 줄이면 화면이 그만큼 더 빠르게 갱신됩니다.
  const [{ data: stops }, eventsRes] = await Promise.all([
    supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds),
    supabase.from("shuttle_run_events").select("route_id, event, created_at").in("route_id", routeIds).eq("service_date", today).order("created_at", { ascending: true }),
  ]);
  const stopIds = (stops ?? []).map((s) => s.id);
  const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

  const { data: assignments } = stopIds.length
    ? await supabase
        .from("shuttle_assignments")
        .select("id, stop_id, student_name_raw, weekdays, override_route_id, choice_group")
        .in("stop_id", stopIds)
    : { data: [] as { id: string; stop_id: string; student_name_raw: string; weekdays: number[]; override_route_id: string | null; choice_group: string | null }[] };
  const relevant = (assignments ?? []).filter((a) => (a.weekdays as number[]).includes(todayWeekday));
  const assignmentIds = relevant.map((a) => a.id);

  const boardingsRes = assignmentIds.length
    ? await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status, override_route_id")
        .eq("service_date", today)
        .in("assignment_id", assignmentIds)
    : { data: [] as { assignment_id: string; status: string; override_route_id: string | null }[] };

  const eventsByRoute: Record<string, { event: string; created_at: string }[]> = {};
  for (const e of eventsRes.data ?? []) {
    (eventsByRoute[e.route_id] ??= []).push({ event: e.event, created_at: e.created_at });
  }

  const boardingByAssignment = new Map((boardingsRes.data ?? []).map((b) => [b.assignment_id, b]));
  const routeIdSet = new Set(routeIds);

  // 하원 체크표에서 오늘 하루만 다른 노선으로 옮긴 학생은 원래 노선이 아니라 옮겨진 노선의
  // 명단에 나타납니다(요청: "표안에서 아이들의 이름을 자유롭게 끌어서 이동할 수 있게"). 계속
  // 유지되도록 영구로 옮긴 경우(shuttle_assignments.override_route_id)는 오늘 하루만의 이동이
  // 없으면 그 노선을 기본값으로 씁니다.
  const rosterByRoute: Record<string, { studentName: string; status: string }[]> = {};
  for (const a of relevant) {
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    const boarding = boardingByAssignment.get(a.id);
    // 행선지를 그날 정하는 학생은, 정하기 전까지 어느 명단에도 넣지 않습니다.
    if (isUndecidedChoice(a, boarding)) continue;
    const permanentRouteId = a.override_route_id && routeIdSet.has(a.override_route_id) ? a.override_route_id : stop.route_id;
    const targetRouteId = boarding?.override_route_id && routeIdSet.has(boarding.override_route_id) ? boarding.override_route_id : permanentRouteId;
    const list = rosterByRoute[targetRouteId] ?? (rosterByRoute[targetRouteId] = []);
    list.push({ studentName: a.student_name_raw, status: boarding?.status ?? "예정" });
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
