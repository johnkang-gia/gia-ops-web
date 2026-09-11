import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import DismissalRosterClient, { type RosterRoute, type RosterAssignment, type RosterStudent } from "@/components/shuttle/DismissalRosterClient";
import { effectiveRouteId, routeChoiceOf } from "@/lib/shuttleRoute";

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
      // **계속 이동(`override_route_id`)을 반드시 함께 읽습니다.**
      //
      // 이 칸을 안 읽던 동안, 명단은 「정류장이 속한 노선」만 보고 아이를 그렸습니다. 체크표는
      // 이동을 보고 그렸습니다. 그래서 이예온을 명단에서 28호에 넣어도 체크표에는 다른 호차에
      // 떴고, 명단 쪽에서는 **왜 그런지 알 방법조차 없었습니다** - 이동이 걸려 있다는 사실이
      // 화면 어디에도 안 나왔으니까요.
      const { data: a } = await supabase
        .from("shuttle_assignments")
        .select("id, stop_id, student_id, student_name_raw, weekdays, note, override_route_id")
        .in("stop_id", stopIds)
        .order("student_name_raw");
      assigns = (a ?? []) as RosterAssignment[];
    }
  }

  const firstStop = new Map<string, string>();
  for (const st of stops) if (!firstStop.has(st.route_id)) firstStop.set(st.route_id, st.id);

  // 어느 카드에 그릴지는 **실제로 타는 노선**으로 정합니다. 판정은 `effectiveRouteId` 한
  // 곳에서만 합니다(CLAUDE.md 2-11) - 여기서 다시 쓰면 체크표와 또 갈라집니다.
  const knownRoute = (id: string) => routeIds.includes(id);
  const byRoute = new Map<string, RosterAssignment[]>();
  for (const a of assigns) {
    const home = stopRoute.get(a.stop_id);
    if (!home) continue;
    const rid = effectiveRouteId(
      routeChoiceOf({ stopRouteId: home, assignmentOverride: a.override_route_id }, knownRoute),
    );
    (byRoute.get(rid) ?? byRoute.set(rid, []).get(rid)!).push({ ...a, homeRouteId: home });
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

  // 명부. 이름을 손으로 치지 않고 여기서 고르게 합니다 - 오타 한 글자면 다른 아이가 되고,
  // 그 줄은 대시보드·체크표에서 학생을 못 찾습니다.
  const { data: studentRows } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name")
    .eq("status", "active")
    .eq("is_demo", false)
    .order("grade")
    .order("name");

  return (
    <DismissalRosterClient
      initialRoutes={rosterRoutes}
      students={((studentRows as RosterStudent[] | null) ?? [])}
    />
  );
}
