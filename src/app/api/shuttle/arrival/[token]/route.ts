import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 교직원이 로그인 없이 링크 하나로 접속해 노선별 "도착" / "출발(다 태움)"만 누르는 단독 화면용
// API입니다(요청: "교직원이 모바일로 도착한 차량 누를 수 있는 단독 링크" - 여름캠프처럼 GPS
// 위치 전송이나 학생별 개별 탑승 체크 없이, 차량이 왔다/떠났다만 빠르게 알리면 되는 경우).
// shuttle_arrival_links.token(추측 불가능한 uuid)으로만 인증하고 service role로 조회·기록합니다
// (파일럿 체크인/안내보드와 같은 패턴). 링크의 term(예: '여름캠프2')에 속한 노선만 다룹니다.
async function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function loadLink(supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>, token: string) {
  const { data: link, error } = await supabase
    .from("shuttle_arrival_links")
    .select("id, label, term, enabled")
    .eq("token", token)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!link || !link.enabled) return { error: "유효하지 않거나 종료된 링크입니다." };
  return { link };
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await getSupabase();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const { link, error } = await loadLink(supabase, token);
  if (error || !link) return NextResponse.json({ error: error ?? "유효하지 않은 링크입니다." }, { status: 403 });

  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", link.term)
    .order("sort_order");
  const routeIds = (routes ?? []).map((r) => r.id);
  if (routeIds.length === 0) {
    return NextResponse.json({ label: link.label, term: link.term, routes: [] });
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayWeekday = new Date().getDay();

  const { data: stops } = await supabase.from("shuttle_stops").select("id, route_id").in("route_id", routeIds);
  const stopIds = (stops ?? []).map((s) => s.id);
  const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

  const { data: assignments } = stopIds.length
    ? await supabase.from("shuttle_assignments").select("stop_id, student_name_raw, weekdays").in("stop_id", stopIds)
    : { data: [] as { stop_id: string; student_name_raw: string; weekdays: number[] }[] };
  const relevant = (assignments ?? []).filter((a) => (a.weekdays as number[]).includes(todayWeekday));

  const rosterByRoute: Record<string, string[]> = {};
  for (const a of relevant) {
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    (rosterByRoute[stop.route_id] ??= []).push(a.student_name_raw);
  }

  const { data: events } = await supabase
    .from("shuttle_run_events")
    .select("route_id, event, created_at")
    .in("route_id", routeIds)
    .eq("service_date", today)
    .order("created_at", { ascending: true });
  const eventsByRoute: Record<string, { event: string; created_at: string }[]> = {};
  for (const e of events ?? []) {
    (eventsByRoute[e.route_id] ??= []).push({ event: e.event, created_at: e.created_at });
  }

  const payload = (routes ?? []).map((r) => ({
    routeId: r.id,
    routeNo: r.route_no,
    name: r.name,
    roster: (rosterByRoute[r.id] ?? []).sort((a, b) => a.localeCompare(b, "ko")),
    events: eventsByRoute[r.id] ?? [],
  }));

  return NextResponse.json({ label: link.label, term: link.term, routes: payload });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await getSupabase();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const { link, error } = await loadLink(supabase, token);
  if (error || !link) return NextResponse.json({ error: error ?? "유효하지 않은 링크입니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const routeId = body?.routeId as string | undefined;
  const action = body?.action as string | undefined;
  if (!routeId || !action || !["arrive", "depart"].includes(action)) {
    return NextResponse.json({ error: "routeId, action(arrive|depart)이 필요합니다." }, { status: 400 });
  }

  // 이 링크의 term에 속한 노선인지 확인(다른 term의 노선 id를 넣어도 기록되지 않게).
  const { data: route } = await supabase.from("shuttle_routes").select("id, term").eq("id", routeId).maybeSingle();
  if (!route || route.term !== link.term) {
    return NextResponse.json({ error: "이 링크에서 다룰 수 없는 노선입니다." }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const event = action === "arrive" ? "현장도착" : "출발";
  const { error: insertError } = await supabase.from("shuttle_run_events").insert({
    service_date: today,
    route_id: routeId,
    event,
    created_by: `도착체크(${link.label})`,
  });
  if (insertError) {
    // 같은 노선·같은 날 '현장도착' 중복 삽입은 부분 유니크 인덱스 위반(23505)으로 막힙니다 -
    // 이미 다른 교직원이 체크한 정상 상황이므로 에러로 취급하지 않습니다.
    if (insertError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
