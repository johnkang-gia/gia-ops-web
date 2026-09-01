import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/shuttleTracking";
import { isUndecidedChoice } from "@/lib/shuttleChoice";

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
    .select("id, route_no, name, driver_name, driver_phone, vehicle_no")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", link.term)
    .order("sort_order");
  const routeIds = (routes ?? []).map((r) => r.id);
  if (routeIds.length === 0) {
    return NextResponse.json({ label: link.label, term: link.term, routes: [] });
  }

  // 날짜·요일은 **한국 기준**이어야 합니다.
  //
  // toISOString()은 UTC라 한국 아침 9시 전에는 어제 날짜가 나옵니다. getDay()도 서버
  // 시간대(Vercel=UTC)를 따라 요일이 하루 밀립니다. 그러면 아침에 이 화면을 열었을 때
  // **어제 명단이 뜨거나, 오늘 안 타는 아이가 명단에 뜹니다.**
  const { iso: today, weekday: todayWeekday } = kstParts(new Date());

  // stops와 run_events는 서로 무관하게 routeIds만 있으면 바로 조회할 수 있어서 병렬로
  // 묶었습니다(요청: "실시간 반영 속도 더 개선") - 이 화면은 3초마다 폴링하는 화면이라, 매
  // 요청의 왕복 횟수를 하나 줄이면 그만큼 화면 반영이 빨라집니다.
  const [{ data: stops }, { data: events }] = await Promise.all([
    supabase.from("shuttle_stops").select("id, route_id, address").in("route_id", routeIds),
    supabase
      .from("shuttle_run_events")
      .select("route_id, event, created_at, created_by")
      .in("route_id", routeIds)
      .eq("service_date", today)
      .order("created_at", { ascending: true }),
  ]);
  const stopIds = (stops ?? []).map((s) => s.id);
  const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

  const { data: assignments } = stopIds.length
    ? await supabase
        .from("shuttle_assignments")
        .select("id, stop_id, student_name_raw, weekdays, override_route_id, choice_group, choice_label")
        .in("stop_id", stopIds)
    : { data: [] as { id: string; stop_id: string; student_name_raw: string; weekdays: number[]; override_route_id: string | null; choice_group: string | null; choice_label: string | null }[] };
  const relevant = (assignments ?? []).filter((a) => (a.weekdays as number[]).includes(todayWeekday));
  const assignmentIds = relevant.map((a) => a.id);

  // 하원 체크표에서 오늘 하루만 다른 노선으로 옮긴 학생은 그 노선 명단에 나타납니다(요청:
  // "표안에서 아이들의 이름을 자유롭게 끌어서 이동할 수 있게"). 계속 유지되도록 영구로 옮긴
  // 경우(shuttle_assignments.override_route_id)는 오늘 하루만의 이동이 없으면 그 노선을 씁니다.
  // status도 함께 가져와서 픽업·결석 학생은 명단에서 뺍니다(요청: "결석이나 픽업을 체크하면
  // 실시간으로 교직원 차량 도착 출발체크에 반영이 되고" - 안내보드(shuttle-board)와 같은
  // 방식으로 shuttle_boardings.status를 조회합니다).
  const { data: boardings } = assignmentIds.length
    ? await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status, override_route_id")
        .eq("service_date", today)
        .in("assignment_id", assignmentIds)
    : { data: [] as { assignment_id: string; status: string; override_route_id: string | null }[] };
  const boardingByAssignment = new Map((boardings ?? []).map((b) => [b.assignment_id, b]));
  const routeIdSet = new Set(routeIds);

  // 행선지를 그날 정하는 학생. 정하기 전에는 어느 노선 명단에도 넣지 않고, 따로 모아
  // 화면 맨 위에 "아직 안 물어봤다"로 띄웁니다.
  const pendingChoice: { assignmentId: string; studentName: string; group: string; routeId: string; stopAddress: string | null; label: string | null }[] = [];

  // assignmentId를 함께 보냅니다. 현장에서 아이 이름을 눌러 픽업으로 바꾸려면, 어느 배정
  // 줄인지 알아야 합니다. 이름만으로는 동명이인을 가릴 수 없습니다.
  const rosterByRoute: Record<string, { assignmentId: string; studentName: string; status: string }[]> = {};
  for (const a of relevant) {
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    const boarding = boardingByAssignment.get(a.id);
    if (isUndecidedChoice(a, boarding)) {
      pendingChoice.push({
        assignmentId: a.id,
        studentName: a.student_name_raw,
        group: a.choice_group as string,
        routeId: (a.override_route_id && routeIdSet.has(a.override_route_id) ? a.override_route_id : stop.route_id) as string,
        // 어디서 내리는지 함께 보냅니다. 호차 번호만 보고 누르면, 형제가 서로 다른 곳에
        // 내리게 잘못 눌러도 아무도 모릅니다.
        stopAddress: ((stop as { address?: string | null }).address ?? null),
        // 아이에게 묻는 말 그대로("학원" / "집·기업은행"). 비어 있으면 호차 번호를 씁니다.
        label: (a.choice_label as string | null) ?? null,
      });
      continue;
    }
    const permanentRouteId = a.override_route_id && routeIdSet.has(a.override_route_id) ? a.override_route_id : stop.route_id;
    const targetRouteId = boarding?.override_route_id && routeIdSet.has(boarding.override_route_id) ? boarding.override_route_id : permanentRouteId;
    (rosterByRoute[targetRouteId] ??= []).push({ assignmentId: a.id, studentName: a.student_name_raw, status: boarding?.status ?? "예정" });
  }

  const eventsByRoute: Record<string, { event: string; created_at: string; createdBy: string | null }[]> = {};
  for (const e of events ?? []) {
    (eventsByRoute[e.route_id] ??= []).push({ event: e.event, created_at: e.created_at, createdBy: e.created_by ?? null });
  }

  // 요청: "모바일로 제대로 (GPS가) 돌아가는지 체크할 수 있도록" - 노선별로 기사님 휴대폰이
  // 마지막으로 위치를 보내온 시각을 함께 내려, 화면에서 "GPS 살아있음/끊김"을 눈으로 확인할 수
  // 있게 합니다. 기기가 아직 없거나(설정 전) 꺼둔 노선은 null입니다.
  const { data: devices } = await supabase
    .from("shuttle_tracker_devices")
    .select("route_id, last_seen_at, enabled")
    .in("route_id", routeIds);
  const gpsByRoute = new Map<string, string | null>();
  for (const d of devices ?? []) {
    if (d.enabled === false) continue;
    // 한 노선에 기기가 여럿이면 가장 최근 신호를 씁니다.
    const prev = gpsByRoute.get(d.route_id as string);
    const cur = d.last_seen_at as string | null;
    if (!prev || (cur && cur > prev)) gpsByRoute.set(d.route_id as string, cur);
  }

  // 담당자: "차량 도착출발 체크에서 애들 배정되지 않은 호차는 없애고."
  //
  // 맞습니다. 아무도 안 타는 차의 [도착]·[출발] 버튼은 누를 일이 없는데 자리만 차지하고,
  // 급할 때 옆 칸을 잘못 누르게 만듭니다. 오늘 탈 학생이 하나도 없는 노선은 뺍니다.
  const payload = (routes ?? [])
    .filter((r) => (rosterByRoute[r.id] ?? []).length > 0)
    .map((r) => ({
    routeId: r.id,
    routeNo: r.route_no,
    name: r.name,
    driverName: r.driver_name,
    driverPhone: r.driver_phone,
    vehicleNo: r.vehicle_no,
    roster: (rosterByRoute[r.id] ?? []).sort((a, b) => a.studentName.localeCompare(b.studentName, "ko")),
    events: eventsByRoute[r.id] ?? [],
    // 기사님 휴대폰이 마지막으로 위치를 보내온 시각(GPS 살아있는지 확인용). 기기 미설정이면 null.
    gpsLastSeen: gpsByRoute.has(r.id) ? gpsByRoute.get(r.id) ?? null : null,
    hasDevice: gpsByRoute.has(r.id),
  }));

  // 노선 번호를 붙여 화면에서 "학원(4-2호)" 처럼 보여줄 수 있게 합니다.
  const routeNoById = new Map((routes ?? []).map((r) => [r.id, r.route_no as string]));
  const choices = pendingChoice.map((p) => ({ ...p, routeNo: routeNoById.get(p.routeId) ?? "?" }));

  return NextResponse.json({ label: link.label, term: link.term, routes: payload, pendingChoice: choices });
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
  // 여기도 한국 날짜여야 합니다. 위(GET)와 다른 날짜를 쓰면 눌러도 화면이 안 바뀝니다.
  const { iso: today } = kstParts(new Date());

  // ── 행선지 선택 ──────────────────────────────────────────────────────────
  //
  // 담당자: "모바일로 볼 수 있었던 교직원 도착체크 단독 링크 부분에서 체크할 수 있도록
  //          만들어줘."
  //
  // 아이에게 직접 물어보는 사람이 이 화면을 들고 있습니다. 물어본 그 자리에서 누르지 못하면
  // 나중에 옮겨 적어야 하고, 옮겨 적는 일은 반드시 언젠가 빠집니다.
  //
  // 고른 배정에만 오늘치 탑승 줄을 만듭니다. 안 고른 쪽은 줄이 없으니 계속 숨어 있습니다.
  // 하원 지도 중에 학부모님이 찾아오셔서 아이를 데려가시는 일이 하루에도 여러 번 있습니다.
  // 그때 이 화면을 들고 있는 사람이 그 자리에서 누를 수 있어야 합니다. 나중에 사무실에 가서
  // 옮겨 적기로 하면, 그 사이에 그 아이는 여전히 "차를 기다리는 아이"로 남습니다.
  if (action === "student_pickup") {
    const assignmentId = body?.assignmentId as string | undefined;
    const on = body?.on !== false; // 기본은 픽업으로 켜기. 잘못 눌렀으면 on:false로 되돌립니다.
    if (!assignmentId) return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });

    const { error } = await supabase.from("shuttle_boardings").upsert(
      {
        service_date: today,
        assignment_id: assignmentId,
        status: on ? "픽업" : "예정",
        // 누가 왜 바꿨는지. 이 화면은 로그인이 없어 사람 이름을 알 수 없으므로 자리를 적습니다.
        checked_by: on ? "하원지도(현장 픽업)" : "하원지도(픽업 취소)",
        checked_at: new Date().toISOString(),
      },
      { onConflict: "service_date,assignment_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "choose") {
    const assignmentId = body?.assignmentId as string | undefined;
    const mode = (body?.mode as string | undefined) ?? "ride"; // ride | skip | reset
    if (!assignmentId) return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });

    const { data: asg } = await supabase
      .from("shuttle_assignments")
      .select("id, choice_group")
      .eq("id", assignmentId)
      .maybeSingle();
    if (!asg?.choice_group) {
      return NextResponse.json({ error: "행선지를 고르는 학생이 아닙니다." }, { status: 400 });
    }

    // 같은 묶음의 다른 배정에 오늘 줄이 남아 있으면 지웁니다. 안 그러면 마음을 바꿨을 때
    // **두 노선에 동시에 뜹니다** - 지금 고치려는 바로 그 상황입니다.
    const { data: siblings } = await supabase
      .from("shuttle_assignments")
      .select("id")
      .eq("choice_group", asg.choice_group);
    const sibIds = (siblings ?? []).map((x) => x.id as string);
    if (sibIds.length > 0) {
      await supabase.from("shuttle_boardings").delete().eq("service_date", today).in("assignment_id", sibIds);
    }

    if (mode === "reset") return NextResponse.json({ ok: true, cleared: true });

    const { error: insErr } = await supabase.from("shuttle_boardings").insert({
      service_date: today,
      assignment_id: assignmentId,
      // 안 타는 날은 결석입니다. 셔틀을 안 탄다는 뜻이지 학교를 빠진다는 뜻이 아니라서
      // checked_by에 이유를 남깁니다.
      //
      // 예전에는 여기에 updated_by를 적었습니다. **그 칸은 이 표에 없습니다.** 그래서 이
      // 저장이 매번 실패했고, 행선지를 정해줘도 그 아이는 체크표에 나타나지 않았습니다.
      status: mode === "skip" ? "결석" : "예정",
      checked_by: mode === "skip" ? "행선지 확인(오늘 안 탐)" : "행선지 확인",
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // 요청: "출발함 상태에서 한번 더 누르면 다시 원래상태로 돌아올 수 있도록" - 매일 반복되는
  // 체크라 실수해도 바로 되돌릴 수 있어야 합니다(정규학기 실시간 셔틀 화면의 "취소" 버튼과
  // 같은 방식으로, 그날 기록된 도착·출발 이벤트를 지워서 "미도착" 상태로 되돌립니다).
  if (action === "reset") {
    if (!routeId) return NextResponse.json({ error: "routeId가 필요합니다." }, { status: 400 });
    const { data: route } = await supabase.from("shuttle_routes").select("id, term").eq("id", routeId).maybeSingle();
    if (!route || route.term !== link.term) {
      return NextResponse.json({ error: "이 링크에서 다룰 수 없는 노선입니다." }, { status: 403 });
    }
    const { error: deleteError } = await supabase
      .from("shuttle_run_events")
      .delete()
      .eq("service_date", today)
      .eq("route_id", routeId)
      .in("event", ["현장도착", "출발"]);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // 요청: "매일매일 체크하는거니까, 전체 리셋 할 수 있고" - 이 링크의 term에 속한 오늘의 모든
  // 노선을 한 번에 "미도착" 상태로 되돌립니다(잘못 누른 걸 하나하나 되돌리는 대신 한 번에).
  if (action === "reset_all") {
    const { data: routes } = await supabase.from("shuttle_routes").select("id").eq("active", true).eq("direction", "하원").eq("term", link.term);
    const routeIds = (routes ?? []).map((r) => r.id);
    if (routeIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("shuttle_run_events")
        .delete()
        .eq("service_date", today)
        .in("route_id", routeIds)
        .in("event", ["현장도착", "출발"]);
      if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!routeId || !action || !["arrive", "depart"].includes(action)) {
    return NextResponse.json({ error: "routeId, action(arrive|depart|reset|reset_all)이 필요합니다." }, { status: 400 });
  }

  // 이 링크의 term에 속한 노선인지 확인(다른 term의 노선 id를 넣어도 기록되지 않게).
  const { data: route } = await supabase.from("shuttle_routes").select("id, term").eq("id", routeId).maybeSingle();
  if (!route || route.term !== link.term) {
    return NextResponse.json({ error: "이 링크에서 다룰 수 없는 노선입니다." }, { status: 403 });
  }

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
