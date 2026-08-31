import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { redirect } from "next/navigation";
import { todayKst, kstDateOffset } from "@/lib/kst";
import ShuttleCapacityClient, { type CapacityRow } from "@/components/shuttle/ShuttleCapacityClient";

// 정원 대비 탑승률.
//
// 담당자가 채택: "정원 대비 탑승률."
//
// 차량을 늘릴지 줄일지, 어느 노선을 합칠지는 지금까지 **기억과 인상**으로 정했습니다.
// "그 차는 늘 비어 보이던데" 같은 말은 맞을 때도 있고 아닐 때도 있습니다.
//
// 두 가지를 나눠서 봅니다. 섞으면 잘못된 결론이 납니다.
//   · **배정 인원 / 정원** — 명부상 몇 명을 태우기로 했는가. 계획입니다.
//   · **실제 탑승 / 정원** — 픽업·결석을 빼고 진짜 몇 명이 탔는가. 현실입니다.
//
// 계획은 꽉 찼는데 실제가 절반이면 차를 줄일 게 아니라 **왜 안 타는지**를 봐야 합니다.
// 둘 다 낮으면 그때가 노선을 합칠 때입니다.

export const dynamic = "force-dynamic";

const MAX_DAYS = 120;

export default async function ShuttleCapacityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayKst();
  const fromRaw = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : kstDateOffset(-30);
  const minFrom = new Date(new Date(`${to}T00:00:00Z`).getTime() - MAX_DAYS * 86400000).toISOString().slice(0, 10);
  const from = fromRaw < minFrom ? minFrom : fromRaw;
  const clamped = fromRaw < minFrom;

  const supabase = await createClient();

  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name, direction, term, seat_capacity, usable_capacity, driver_name")
    .eq("active", true)
    .order("sort_order");
  const routeList = (routes ?? []) as {
    id: string;
    route_no: string;
    name: string | null;
    direction: string;
    term: string;
    seat_capacity: number | null;
    usable_capacity: number | null;
    driver_name: string | null;
  }[];
  const routeIds = routeList.map((r) => r.id);

  const { data: stops } = routeIds.length
    ? await supabase.from("shuttle_stops").select("id, route_id").in("route_id", routeIds)
    : { data: [] };
  const stopRoute = new Map(((stops ?? []) as { id: string; route_id: string }[]).map((s) => [s.id, s.route_id]));

  const stopIds = [...stopRoute.keys()];
  const { data: assigns } = stopIds.length
    ? await supabase.from("shuttle_assignments").select("id, stop_id, choice_group").in("stop_id", stopIds)
    : { data: [] };
  const assignList = (assigns ?? []) as { id: string; stop_id: string; choice_group: string | null }[];
  const assignRoute = new Map(assignList.map((a) => [a.id, stopRoute.get(a.stop_id) ?? ""]));

  // 노선별 배정 인원(계획).
  const plannedByRoute = new Map<string, number>();
  for (const a of assignList) {
    const rid = assignRoute.get(a.id);
    if (!rid) continue;
    plannedByRoute.set(rid, (plannedByRoute.get(rid) ?? 0) + 1);
  }

  // 기간 안 실제 탑승(현실). 픽업·결석은 빼고 셉니다 - 그날 그 차에 실제로 탄 사람만.
  const { data: boardings, error } = await supabase
    .from("shuttle_boardings")
    .select("assignment_id, status, service_date, override_route_id")
    .gte("service_date", from)
    .lte("service_date", to)
    .limit(30000);
  const bRows = (boardings ?? []) as {
    assignment_id: string;
    status: string;
    service_date: string;
    override_route_id: string | null;
  }[];

  // 날짜별·노선별 실제 탑승 인원. 하루 평균을 내려면 "며칠 운행했는지"도 알아야 합니다.
  const ridePerDay = new Map<string, Map<string, number>>(); // routeId -> date -> count
  const daysByRoute = new Map<string, Set<string>>();
  for (const b of bRows) {
    // 그날만 다른 차로 옮긴 경우는 옮겨간 차로 셉니다.
    const rid = b.override_route_id ?? assignRoute.get(b.assignment_id);
    if (!rid) continue;
    (daysByRoute.get(rid) ?? daysByRoute.set(rid, new Set()).get(rid)!).add(b.service_date);
    if (b.status === "픽업" || b.status === "결석") continue;
    const byDate = ridePerDay.get(rid) ?? ridePerDay.set(rid, new Map()).get(rid)!;
    byDate.set(b.service_date, (byDate.get(b.service_date) ?? 0) + 1);
  }

  const rows: CapacityRow[] = routeList.map((r) => {
    const planned = plannedByRoute.get(r.id) ?? 0;
    const byDate = ridePerDay.get(r.id) ?? new Map<string, number>();
    const days = daysByRoute.get(r.id)?.size ?? 0;
    const counts = [...byDate.values()];
    const totalRides = counts.reduce((s, n) => s + n, 0);
    // 평균은 **기록이 있는 날로만** 나눕니다. 운행 안 한 날까지 나누면 실제보다 낮게 나옵니다.
    const avgRide = days > 0 ? totalRides / days : 0;
    const peak = counts.length > 0 ? Math.max(...counts) : 0;
    // 태울 수 있는 인원은 usable(실제 탑승 가능)을 먼저 씁니다. 정원과 다를 수 있습니다.
    const cap = r.usable_capacity ?? r.seat_capacity ?? null;
    return {
      id: r.id,
      routeNo: r.route_no,
      name: r.name,
      direction: r.direction,
      term: r.term,
      driver: r.driver_name,
      capacity: cap,
      seatCapacity: r.seat_capacity,
      planned,
      avgRide: Math.round(avgRide * 10) / 10,
      peak,
      days,
    };
  });

  return (
    <ShuttleCapacityClient
      rows={rows}
      from={from}
      to={to}
      clamped={clamped}
      maxDays={MAX_DAYS}
      loadError={error?.message ?? null}
    />
  );
}
