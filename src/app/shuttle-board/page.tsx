import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { ShuttleRoute, ShuttlePilotRoute } from "@/lib/types";
import ShuttleBoardClient, { type BoardRosterItem } from "@/components/shuttle/ShuttleBoardClient";

export const dynamic = "force-dynamic";

// 안내보드 - 복도/로비 등에 있는 화면(요청: "체크된 차량 유튜브시청가능한 안내보드에서 도착한
// 차량과 탑승할 아이들 안내")에 띄워두는 큰 화면용 페이지입니다. (dashboard) 레이아웃 밖에
// 두어 사이드바 없이 전체 화면으로 뜨지만, 로그인은 그대로 필요합니다(토큰 링크가 아닌 일반
// 교직원 계정 - shuttle-pilot/shuttle-parent와 달리 앞에 "shuttle-"만 붙고 로그인은 필요합니다).
// 교직원이 /shuttle/live에서 '현장도착'을 체크한 하원 차량만, 아직 태워야 할 학생 이름과 함께
// 큰 글씨로 보여줍니다. 동승선생님이 체크인 화면에서 탑승을 체크하면 이 화면에도 실시간(폴링)으로
// 반영됩니다.
export default async function ShuttleBoardPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const [routesRes, pilotsRes] = await Promise.all([
    supabase.from("shuttle_routes").select("*").eq("active", true).eq("direction", "하원").order("sort_order"),
    supabase.from("shuttle_pilot_routes").select("*"),
  ]);
  const routes = (routesRes.data as ShuttleRoute[] | null) ?? [];
  const routeIds = routes.map((r) => r.id);

  let stopsData: { id: string; route_id: string; seq: number }[] = [];
  let assignmentsData: { id: string; stop_id: string; student_name_raw: string; weekdays: number[] }[] = [];
  if (routeIds.length > 0) {
    const stopsRes = await supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds);
    stopsData = stopsRes.data ?? [];
    const stopIds = stopsData.map((s) => s.id);
    if (stopIds.length > 0) {
      const assignRes = await supabase.from("shuttle_assignments").select("id, stop_id, student_name_raw, weekdays").in("stop_id", stopIds);
      assignmentsData = assignRes.data ?? [];
    }
  }

  const todayWeekday = new Date().getDay();
  const stopById = new Map(stopsData.map((s) => [s.id, s]));
  const rosterByRoute: Record<string, BoardRosterItem[]> = {};
  for (const a of assignmentsData) {
    if (!a.weekdays.includes(todayWeekday)) continue;
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    const list = rosterByRoute[stop.route_id] ?? (rosterByRoute[stop.route_id] = []);
    list.push({ assignmentId: a.id, studentName: a.student_name_raw });
  }
  for (const key of Object.keys(rosterByRoute)) {
    rosterByRoute[key].sort((x, y) => x.studentName.localeCompare(y.studentName, "ko"));
  }

  return <ShuttleBoardClient routes={routes} pilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []} rosterByRoute={rosterByRoute} />;
}
