import { redirect } from "next/navigation";
import { ridingIds } from "@/lib/ridesToday";
import { todayKst } from "@/lib/kst";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_SHUTTLE_TERM } from "@/lib/shuttleTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import { categorize } from "@/lib/attendanceDigest";
import type { ShuttleRoute, ShuttleStop, ShuttleAssignment } from "@/lib/types";
import ShuttleOverviewClient, { type RouteStat, type OverviewKpi } from "@/components/shuttle/ShuttleOverviewClient";
import { normName, splitNameMark } from "@/lib/studentLabel";

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

  const today0 = todayKst();

  //
  // ── 한 번에 묻습니다 ─────────────────────────────────────────────────────
  //
  // 예전에는 **여덟 번을 차례로** 기다렸습니다. 뒤의 조회들이 앞에서 받은 노선·정류장 번호를
  // `.in()` 열쇠로 썼기 때문인데, 정류장·배정은 표 전체가 수백 줄이라 **통째로 받아 여기서
  // 거르는 편**이 왕복 여러 번을 아낍니다. 거르는 결과는 같습니다.
  //
  // 노선도 한 번만 받습니다. 개요 표(하원)와 아래 지도(등·하원 전부)가 **같은 학기의 같은
  // 표**를 보고 있었는데 따로 물었습니다 - 한 번 받아 하원만 걸러 쓰면 됩니다.
  const [allRoutesRes, allStopsRes, asgBasicRes, preqRes, boardingsRes, notesRes, devicesRes, regionAsgRes] =
    await Promise.all([
      // 지금 학기 노선 전부. 예전에는 여름캠프 노선까지 지도에 얹혀 같은 호차가 두 번 보였습니다.
      supabase.from("shuttle_routes").select("*").eq("term", CURRENT_SHUTTLE_TERM).eq("active", true).order("direction").order("sort_order"),
      supabase.from("shuttle_stops").select("*").order("seq"),
      supabase.from("shuttle_assignments_basic").select("id, stop_id, student_name_raw, weekdays, student_id"),
      // 오늘 픽업/결석(체크표와 동일: pickup_requests)
      supabase.from("pickup_requests").select("*").eq("is_demo", false).neq("status", "무시").eq("service_date", today0),
      // 오늘 탑승 기록
      supabase.from("shuttle_boardings").select("assignment_id, status").eq("service_date", today0),
      // 지속 특이사항 목록(개요에 요약 표시)
      supabase
        .from("shuttle_persistent_notes")
        .select("student_name, route_no, content, effect_kind, effect_days")
        .eq("term", term)
        .eq("active", true)
        .order("created_at", { ascending: false }),
      // GPS 기기 상태
      supabase.from("shuttle_tracker_devices").select("route_id, last_hit_at, enabled"),
      supabase.from("shuttle_assignments").select("id, stop_id"),
    ]);

  const allRoutes = (allRoutesRes.data ?? []) as ShuttleRoute[];
  // 개요 표는 하원만 봅니다(요청: 하원 우선). 지도는 등·하원을 함께 그립니다.
  const routes = allRoutes.filter((r) => r.direction === "하원");
  const routeIds = routes.map((r) => r.id as string);
  const routeIdSet = new Set(routeIds);

  const today = today0;
  const todayWeekday = new Date().getDay();
  // ── 이름 맞대기 ───────────────────────────────────────────────────────
  //
  // 예전에는 한쪽이 다른 쪽을 **품고만 있어도**(`includes`) 같은 사람으로 봤습니다. 그래서
  // 픽업 목록에 「재이」가 있으면 김재이·심재이·유재이의 배정 줄이 **셋 다** 픽업으로
  // 칠해졌습니다. 화면에는 오류가 아니라 그냥 픽업으로 보입니다.
  //
  // 이제 괄호로 적혀 온 반만 떼고(「김재이(G2A)」) **정확히 같을 때만** 같은 사람입니다.
  // 아래에서 학생 번호로 먼저 맞대므로, 이 길은 번호가 없는 옛 줄에만 씁니다.
  const nameMatch = (a: string, b: string) => {
    const x = normName(splitNameMark(a ?? "").name);
    const y = normName(splitNameMark(b ?? "").name);
    return x.length >= 2 && x === y;
  };

  // 정류장 → 배정 → 오늘 탑승자(요일 포함). 위에서 통째로 받은 것을 하원 노선으로 거릅니다.
  const allStops = (allStopsRes.data ?? []) as ShuttleStop[];
  const stops = allStops
    .filter((x) => routeIdSet.has(x.route_id as string))
    .map((x) => ({
      id: x.id as string,
      route_id: x.route_id as string,
      seq: Number(x.seq ?? 0),
      gu: (x.gu as string | null) ?? null,
      dong: (x.dong as string | null) ?? null,
    }));
  const stopIdSet = new Set(stops.map((x) => x.id));
  const assigns = (
    (asgBasicRes.data ?? []) as {
      id: string;
      stop_id: string;
      student_name_raw: string;
      weekdays: number[];
      student_id: string | null;
    }[]
  ).filter((a) => stopIdSet.has(a.stop_id));
  const routeByStop = new Map(stops.map((s) => [s.id, s.route_id]));

  // 노선(호차)별 대표 구 + 동 목록(요청: 지역을 호차 표에 통합). 정류장이 가장 많은 구를 대표로.
  const geoByRoute = new Map<string, { primaryGu: string | null; dongs: string[] }>();
  {
    const acc = new Map<string, { guCount: Map<string, number>; dongs: Set<string> }>();
    for (const s of stops) {
      const e = acc.get(s.route_id) ?? { guCount: new Map<string, number>(), dongs: new Set<string>() };
      if (s.gu) e.guCount.set(s.gu, (e.guCount.get(s.gu) ?? 0) + 1);
      if (s.dong) e.dongs.add(s.dong);
      acc.set(s.route_id, e);
    }
    for (const [rid, e] of acc) {
      let primaryGu: string | null = null;
      let best = 0;
      for (const [g, c] of e.guCount) if (c > best) { best = c; primaryGu = g; }
      geoByRoute.set(rid, { primaryGu, dongs: [...e.dongs] });
    }
  }

  const preq = preqRes.data;
  const pickupNames: string[] = [];
  const absentNames: string[] = [];
  // **학생 번호가 먼저입니다.** 번호는 겹치지 않습니다 - 이름은 셋이 나눠 씁니다.
  const pickupIds = new Set<string>();
  const absentIds = new Set<string>();
  for (const r of preq ?? []) {
    const nm = ((r.matched_name as string | null) ?? (r.ai_student_name as string | null) ?? "").trim();
    const sid = (r.student_id as string | null) ?? null;
    if (!nm && !sid) continue;
    const text = ((r.raw_text as string | null) ?? (r.summary as string | null) ?? "").toString();
    const cat = categorize(text);
    const isPick = r.kind === "픽업" || cat === "픽업";
    if (!isPick && cat !== "결석") continue;
    // 번호가 있으면 번호만 씁니다. 이름은 번호가 없는 줄(아직 학생을 안 이은 연락)에만.
    if (sid) (isPick ? pickupIds : absentIds).add(sid);
    else if (nm) (isPick ? pickupNames : absentNames).push(nm);
  }

  // 오늘 탑승 기록. 오늘치 전부를 받아 이 화면의 배정으로 거릅니다.
  const assignIdSet = new Set(assigns.map((a) => a.id));
  const boardings = ((boardingsRes.data ?? []) as { assignment_id: string; status: string }[]).filter((b) =>
    assignIdSet.has(b.assignment_id),
  );
  const boardStatus = new Map(boardings.map((b) => [b.assignment_id, b.status]));
  // 오늘만 타기로 체크표에서 바꾼 아이도 오늘 인원에 셉니다. 안 세면 정원·좌석 계산이
  // 실제보다 적게 나오는데, 그건 차가 꽉 찬 다음에야 드러납니다.
  const ridingToday = ridingIds(boardings ?? []);

  // 집계
  const perRouteToday = new Map<string, number>();
  const stopRiders = new Map<string, number>(); // 정류장별 오늘 탑승 예정 수
  const stopOut = new Map<string, number>(); // 정류장별 오늘 픽업+결석 수
  let expected = 0, pickup = 0, absent = 0, boarded = 0;
  for (const a of assigns) {
    const riding = (a.weekdays ?? []).includes(todayWeekday) || ridingToday.has(a.id);
    if (!riding) continue;
    const rid = routeByStop.get(a.stop_id);
    if (rid) perRouteToday.set(rid, (perRouteToday.get(rid) ?? 0) + 1);
    stopRiders.set(a.stop_id, (stopRiders.get(a.stop_id) ?? 0) + 1);
    const st = boardStatus.get(a.id);
    const isPickup =
      st === "픽업" ||
      (a.student_id ? pickupIds.has(a.student_id) : false) ||
      pickupNames.some((n) => nameMatch(n, a.student_name_raw));
    const isAbsent =
      st === "결석" ||
      (a.student_id ? absentIds.has(a.student_id) : false) ||
      absentNames.some((n) => nameMatch(n, a.student_name_raw));
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

  const notes = (notesRes.data ?? []).map((n) => {
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

  const devices = devicesRes.data;
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
    const geo = geoByRoute.get(rid);
    return {
      routeNo: r.route_no as string,
      name: (r.name as string | null) ?? null,
      gu: geo?.primaryGu ?? null,
      dong: geo && geo.dongs.length > 0 ? geo.dongs.join(", ") : null,
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

  // 실시간·지역 지도(요청: 실시간·지역 탭을 개요에 통합, 맨 위에 지도). 위 첫 묶음에서
  // 이미 받은 노선·정류장을 그대로 씁니다 - 같은 표를 두 번 묻지 않습니다.

  return (
    <div className="p-4 sm:p-6">
      <ShuttleOverviewClient
        date={dateStr}
        kpi={kpi}
        routes={routeStats}
        pickupNames={[...new Set(pickupNames)]}
        absentNames={[...new Set(absentNames)]}
        notes={notes}
        regionRoutes={allRoutes}
        regionStops={allStops}
        regionAssignments={(regionAsgRes.data as Pick<ShuttleAssignment, "stop_id">[] | null) ?? []}
      />
    </div>
  );
}
