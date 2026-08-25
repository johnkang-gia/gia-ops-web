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
    .select("id, route_no, name, driver_name, sort_order")
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
  let stops: { id: string; route_id: string }[] = [];
  let assigns: { id: string; stop_id: string; student_name_raw: string; weekdays: number[] }[] = [];
  if (routeIds.length) {
    const { data: s } = await supabase.from("shuttle_stops").select("id, route_id").in("route_id", routeIds);
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
  let expected = 0, pickup = 0, absent = 0, boarded = 0;
  for (const a of assigns) {
    const riding = (a.weekdays ?? []).includes(todayWeekday);
    if (!riding) continue;
    const rid = routeByStop.get(a.stop_id);
    if (rid) perRouteToday.set(rid, (perRouteToday.get(rid) ?? 0) + 1);
    const st = boardStatus.get(a.id);
    const isPickup = st === "픽업" || pickupNames.some((n) => nameMatch(n, a.student_name_raw));
    const isAbsent = st === "결석" || absentNames.some((n) => nameMatch(n, a.student_name_raw));
    if (st === "탑승") boarded += 1;
    if (isPickup) pickup += 1;
    else if (isAbsent) absent += 1;
    else expected += 1;
  }

  // 지속 특이사항 수
  const { count: notesCount } = await supabase
    .from("shuttle_persistent_notes")
    .select("id", { count: "exact", head: true })
    .eq("term", term)
    .eq("active", true);

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
    return {
      routeNo: r.route_no as string,
      name: (r.name as string | null) ?? null,
      driver: (r.driver_name as string | null) ?? null,
      color: routeColorAt(i, routes.length),
      today: perRouteToday.get(rid) ?? 0,
      gps,
    };
  });

  const kpi: OverviewKpi = {
    expected,
    pickup,
    absent,
    boarded,
    running,
    totalDevices: (devices ?? []).length,
    notes: notesCount ?? 0,
    lastStopAvg: null,
    pendingPickups: pickupNames.length,
    unsetDevices,
  };

  const dateStr = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="p-4 sm:p-6">
      <ShuttleOverviewClient date={dateStr} kpi={kpi} routes={routeStats} />
    </div>
  );
}
