import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import DismissalRosterClient, { type RosterRoute, type RosterAssignment } from "@/components/shuttle/DismissalRosterClient";

export const dynamic = "force-dynamic";

// 하원 셔틀명단 설정 탭(요청: 하원체크표를 [체크표|셔틀명단] 탭으로). 정규학기 하원 노선의
// 배정(누가 무슨 요일에 타는지)을 노선별 카드로 보여주고 바로 편집합니다.
export default async function DismissalRosterPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const supabase = await createClient();

  const { data: routesRaw } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name, driver_name")
    .eq("direction", "하원")
    .eq("term", "정규학기")
    .eq("active", true);
  const routes = routesRaw ?? [];
  const routeIds = routes.map((r) => r.id as string);

  let stops: { id: string; route_id: string; seq: number }[] = [];
  let assigns: RosterAssignment[] = [];
  const stopRoute = new Map<string, string>();
  if (routeIds.length) {
    const { data: s } = await supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds).order("seq");
    stops = (s ?? []) as typeof stops;
    for (const st of stops) stopRoute.set(st.id, st.route_id);
    const stopIds = stops.map((x) => x.id);
    if (stopIds.length) {
      const { data: a } = await supabase
        .from("shuttle_assignments")
        .select("id, stop_id, student_name_raw, weekdays, note")
        .in("stop_id", stopIds)
        .order("student_name_raw");
      assigns = (a ?? []) as RosterAssignment[];
    }
  }

  const firstStop = new Map<string, string>();
  for (const st of stops) if (!firstStop.has(st.route_id)) firstStop.set(st.route_id, st.id);

  const byRoute = new Map<string, RosterAssignment[]>();
  for (const a of assigns) {
    const rid = stopRoute.get(a.stop_id);
    if (!rid) continue;
    (byRoute.get(rid) ?? byRoute.set(rid, []).get(rid)!).push(a);
  }

  const rosterRoutes: RosterRoute[] = routes
    .map((r) => ({
      id: r.id as string,
      route_no: r.route_no as string,
      name: (r.name as string | null) ?? null,
      driver_name: (r.driver_name as string | null) ?? null,
      firstStopId: firstStop.get(r.id as string) ?? null,
      assignments: byRoute.get(r.id as string) ?? [],
    }))
    // 명단이 없는 노선도 학생을 추가할 수 있게 전부 보여주되, 배정 있는 노선을 앞에.
    .sort((a, b) => Number(b.assignments.length > 0) - Number(a.assignments.length > 0));

  return <DismissalRosterClient initialRoutes={rosterRoutes} />;
}
