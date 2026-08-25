import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { categorize } from "@/lib/attendanceDigest";
import ShuttleOverviewClient, { type RouteStat, type OverviewKpi } from "@/components/shuttle/ShuttleOverviewClient";

export const dynamic = "force-dynamic";

// 지역별로 노선 색을 고르게 나눕니다(체크표의 요일별 묶음 색과 같은 결의 HSL 팔레트).
function routeColorAt(i: number, total: number): string {
  const hue = Math.round((i / Math.max(1, total)) * 360);
  return `hsl(${hue} 70% 45%)`;
}

// 셔틀 "개요 대시보드"(요청: 메뉴 여러 개 → 개요+탭으로 통합, 매일 확인할 것을 한 화면에).
// 오늘 하원의 탑승예정·픽업·결석·운행중 차량·지속 특이사항을 하원 체크표와 같은 규칙으로 집계해
// 보여줍니다.
export default async function ShuttleOverviewPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const term = "정규학기";
  const supabase = await createClient();

  const { data: routesRaw } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name, driver_name, vehicle_no, seat_capacity, usable_capacity, sort_order")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", term)
    .order("sort_order");
  const routes = routesRaw ?? [];
  const routeIds = routes.map((r) => r.id as string);

  const today = new Date().toISOString().slice(0, 10);
  const todayWeekday = new Date().getDay();
  const norm = (s: string) => (s ?? "").replace(/\s+/g, "").trim();
  const nameMatch = (a: string, b: string) => {
    const x = norm(a), y = norm(b);
    if (x.length < 2 || y.length < 2) return false;
    return x === y || x.includes(y) || y.includes(x);
  };

  // 정류장 → 배정 → 오늘 탑승자(요일 포함)
  let stops: { id: string; route_id: string; seq: number }[] = [];
  let assigns: { id: string; stop_id: string; student_name_raw: string; weekdays: number[] }[] = [];
  if (routeIds.length) {
    const { data: s } = await supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds);
    stops = s ?? [];
    const stopIds = stops.map((x) => x.id);
    if (stopIds.length) {
      const { data: a } = await supabase
        .from("shuttle_assignments_basic")
        .select("id, stop_id, student_name_raw, weekdays")
        .in("stop_id", stopIds);
      assigns = a ?? [];
    }
  }
  const routeByStop = new Map(stops.map((s) => [s.id, s.route_id]));

  // 오늘 픽업/결석(체크표와 동일: pickup_requests)
  const { data: preq } = await supabase
    .from("pickup_requests")
    .select("*")
    .eq("is_demo", false)
    .neq("status", "무시")
    .eq("service_date", today);
  const pickupNames: string[] = [];
  const absentNames: string[] = [];
  for (const r of preq ?? []) {
    const nm = ((r.matched_name as string | null) ?? (r.ai_student_name as string | null) ?? "").trim();
    if (!nm) continue;
    const text = ((r.raw_text as string | null) ?? (r.summary as string | null) ?? "").toString();
    const cat = categorize(text);
    if (r.kind === "픽업" || cat === "픽업") pickupNames.push(nm);
    else if (cat === "결석") absentNames.push(nm);
  }

  // 오늘 탑승 기록
  const assignIds = assigns.map((a) => a.id);
  const { data: boardings } = assignIds.length
    ? await supabase.from("shuttle_boardings").select("assignment_id, status").eq("service_date", today).in("assignment_id", assignIds)
    : { data: [] as { assignment_id: string; status: string }[] };
  const boardStatus = new Map((boardings ?? []).map((b) => [b.assignment_id, b.status]));

  // 집계
  const perRouteToday = new Map<string, number>();
  const stopRiders = new Map<string, number>(); // 정류장별 오늘 탑승 예정 수
  const stopOut = new Map<string, number>(); // 정류장별 오늘 픽업+결석 수
  let expected = 0, pickup = 0, absent = 0, boarded = 0;
  for (const a of assigns) {
    const riding = (a.weekdays ?? []).includes(todayWeekday);
    if (!riding) continue;
    const rid = routeByStop.get(a.stop_id);
    if (rid) perRouteToday.set(rid, (perRouteToday.get(rid) ?? 0) + 1);
    stopRiders.set(a.stop_id, (stopRiders.get(a.stop_id) ?? 0) + 1);
    const st = boardStatus.get(a.id);
    const isPickup = st === "픽업" || pickupNames.some((n) => nameMatch(n, a.student_name_raw));
    const isAbsent = st === "결석" || absentNames.some((n) => nameMatch(n, a.student_name_raw));
    if (isPickup || isAbsent) stopOut.set(a.stop_id, (stopOut.get(a.stop_id) ?? 0) + 1);
    if (st === "탑승") boarded += 1;
    if (isPickup) pickup += 1;
    else if (isAbsent) absent += 1;
    else expected += 1;
  }
  // 결석·픽업으로 오늘 전원이 안 타는 정류장은 건너뜁니다(요청 채택: 정류장 스킵 + ETA 재계산).
  const perRouteSkips = new Map<string, number>();
  for (const [sid, riders] of stopRiders) {
    if (riders > 0 && (stopOut.get(sid) ?? 0) >= riders) {
      const rid = routeByStop.get(sid);
      if (rid) perRouteSkips.set(rid, (perRouteSkips.get(rid) ?? 0) + 1);
    }
  }
  const MIN_PER_STOP = 3; // 정류장 1곳 건너뛸 때 아끼는 대략 시간(분)

  // 지속 특이사항 목록(개요에 요약 표시)
  const { data: noteRows } = await supabase
    .from("shuttle_persistent_notes")
    .select("student_name, route_no, content, effect_kind, effect_days")
    .eq("term", term)
    .eq("active", true)
    .order("created_at", { ascending: false });
  const notes = (noteRows ?? []).map((n) => {
    const kind = n.effect_kind as string;
    const days = (n.effect_days as number[] | null) ?? [];
    const effLabel =
      kind === "no_shuttle"
        ? "개별하원"
        : kind === "skip_days"
          ? `${days.map((d) => "일월화수목금토"[d]).join("")}요일 제외`
          : "메모";
    return {
      studentName: n.student_name as string,
      routeNo: (n.route_no as string | null) ?? null,
      content: (n.content as string) ?? "",
      effLabel,
    };
  });
  const notesCount = notes.length;

  // 노선별 막차(마지막 정류장) 평균 도착시각과 오늘 지연(요청 ⑭ 채택: 노선별 예상 소요·지연).
  // 각 노선의 seq가 가장 큰 정류장을 막차 정류장으로 보고, shuttle_stop_arrivals의 도착시각을
  // KST 기준 '자정 이후 분'으로 바꿔 평균과 오늘값을 비교합니다.
  const lastStopByRoute = new Map<string, string>(); // route_id -> stop_id(막차)
  {
    const maxSeq = new Map<string, number>();
    for (const s of stops) {
      const rid = s.route_id;
      if (!maxSeq.has(rid) || s.seq > (maxSeq.get(rid) as number)) {
        maxSeq.set(rid, s.seq);
        lastStopByRoute.set(rid, s.id);
      }
    }
  }
  const lastStopIds = [...lastStopByRoute.values()];
  const kstMinutes = (iso: string) => {
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const h = Number(p.find((x) => x.type === "hour")?.value ?? "0");
    const m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
    return h * 60 + m;
  };
  const fmtMin = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.round(mins % 60)).padStart(2, "0")}`;
  const avgByStop = new Map<string, number>();
  const todayByStop = new Map<string, number>();
  if (lastStopIds.length) {
    const { data: arr } = await supabase
      .from("shuttle_stop_arrivals")
      .select("stop_id, arrived_at, service_date")
      .in("stop_id", lastStopIds)
      .order("service_date", { ascending: false })
      .limit(1500);
    const acc = new Map<string, number[]>();
    for (const a of arr ?? []) {
      const mins = kstMinutes(a.arrived_at as string);
      (acc.get(a.stop_id as string) ?? acc.set(a.stop_id as string, []).get(a.stop_id as string)!).push(mins);
      if ((a.service_date as string) === today) todayByStop.set(a.stop_id as string, mins);
    }
    for (const [sid, list] of acc) avgByStop.set(sid, list.reduce((x, y) => x + y, 0) / list.length);
  }

  // GPS 기기 상태
  const { data: devices } = await supabase
    .from("shuttle_tracker_devices")
    .select("route_id, last_hit_at, enabled");
  const now = Date.now();
  const liveByRoute = new Map<string, boolean>();
  const hasDeviceRoute = new Set<string>();
  let running = 0, unsetDevices = 0;
  for (const d of devices ?? []) {
    const rid = d.route_id as string | null;
    if (rid) hasDeviceRoute.add(rid);
    const last = d.last_hit_at ? new Date(d.last_hit_at as string).getTime() : 0;
    const live = last > 0 && now - last < 10 * 60 * 1000;
    if (live) running += 1;
    if (rid && live) liveByRoute.set(rid, true);
    if (!last) unsetDevices += 1;
  }

  const routeStats: RouteStat[] = routes.map((r, i) => {
    const rid = r.id as string;
    const gps: RouteStat["gps"] = liveByRoute.get(rid) ? "live" : hasDeviceRoute.has(rid) ? "idle" : "none";
    const cap = (r.usable_capacity as number | null) ?? (r.seat_capacity as number | null) ?? null;
    const today = perRouteToday.get(rid) ?? 0;
    const lastStop = lastStopByRoute.get(rid);
    const avg = lastStop ? avgByStop.get(lastStop) : undefined;
    const todayLast = lastStop ? todayByStop.get(lastStop) : undefined;
    const delayMin = avg != null && todayLast != null ? Math.round(todayLast - avg) : null;
    const skipStops = perRouteSkips.get(rid) ?? 0;
    const adjustedLast = avg != null && skipStops > 0 ? fmtMin(Math.max(0, avg - skipStops * MIN_PER_STOP)) : null;
    return {
      routeNo: r.route_no as string,
      name: (r.name as string | null) ?? null,
      driver: (r.driver_name as string | null) ?? null,
      vehicleNo: (r.vehicle_no as string | null) ?? null,
      color: routeColorAt(i, routes.length),
      today,
      capacity: cap,
      over: cap != null && today > cap,
      lastStopAvg: avg != null ? fmtMin(avg) : null,
      todayLast: todayLast != null ? fmtMin(todayLast) : null,
      delayMin,
      skipStops,
      adjustedLast,
      gps,
    };
  });

  const avgValues = [...avgByStop.values()];
  const schoolAvg = avgValues.length ? avgValues.reduce((x, y) => x + y, 0) / avgValues.length : null;
  const kpi: OverviewKpi = {
    expected,
    pickup,
    absent,
    boarded,
    running,
    totalDevices: (devices ?? []).length,
    notes: notesCount ?? 0,
    lastStopAvg: schoolAvg != null ? fmtMin(schoolAvg) : null,
    pendingPickups: pickupNames.length,
    unsetDevices,
    overCount: routeStats.filter((r) => r.over).length,
  };

  const dateStr = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="p-4 sm:p-6">
      <ShuttleOverviewClient
        date={dateStr}
        kpi={kpi}
        routes={routeStats}
        pickupNames={[...new Set(pickupNames)]}
        absentNames={[...new Set(absentNames)]}
        notes={notes}
      />
    </div>
  );
}
