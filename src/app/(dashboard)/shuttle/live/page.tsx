import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { ShuttleRoute, ShuttlePilotRoute } from "@/lib/types";
import ShuttleLiveClient, { type LiveRosterItem } from "@/components/shuttle/ShuttleLiveClient";

export const dynamic = "force-dynamic";

// 교직원 전체(교사 포함)가 로그인만 하면 볼 수 있는 실시간 셔틀 화면입니다(요청: "교직원들이
// 등원과 하원셔틀의 실시간 위치를 바로 알 수 있고, 하원 차량에 학생들을 탑승하라고 안내하고,
// 탑승확인하는 용도로 사용"). 링크 발급·토큰 관리는 여전히 관리자 전용 /shuttle/pilot에서
// 이루어지고, 이 화면은 그 결과(위치·탑승현황)를 보고 '현장도착'만 체크하는 조회+확인 화면입니다.
export default async function ShuttleLivePage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const [routesRes, pilotsRes] = await Promise.all([
    supabase.from("shuttle_routes").select("*").eq("active", true).order("direction").order("sort_order"),
    supabase.from("shuttle_pilot_routes").select("*").order("created_at", { ascending: false }),
  ]);
  const routes = (routesRes.data as ShuttleRoute[] | null) ?? [];
  const routeIds = routes.map((r) => r.id);

  let stopsData: { id: string; route_id: string; seq: number; stop_time: string | null }[] = [];
  let assignmentsData: { id: string; stop_id: string; student_name_raw: string; weekdays: number[] }[] = [];
  if (routeIds.length > 0) {
    const stopsRes = await supabase.from("shuttle_stops").select("id, route_id, seq, stop_time").in("route_id", routeIds).order("seq");
    stopsData = stopsRes.data ?? [];
    const stopIds = stopsData.map((s) => s.id);
    if (stopIds.length > 0) {
      const assignRes = await supabase.from("shuttle_assignments").select("id, stop_id, student_name_raw, weekdays").in("stop_id", stopIds);
      assignmentsData = assignRes.data ?? [];
    }
  }

  // 오늘 요일(1=월...5=금)에 배정된 학생만 노선별로 묶어둡니다(체크인 화면과 같은 필터 기준).
  const todayWeekday = new Date().getDay();
  const stopById = new Map(stopsData.map((s) => [s.id, s]));
  const rosterByRoute: Record<string, LiveRosterItem[]> = {};
  for (const a of assignmentsData) {
    if (!a.weekdays.includes(todayWeekday)) continue;
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    const list = rosterByRoute[stop.route_id] ?? (rosterByRoute[stop.route_id] = []);
    list.push({ assignmentId: a.id, studentName: a.student_name_raw, stopSeq: stop.seq, stopTime: stop.stop_time });
  }
  for (const key of Object.keys(rosterByRoute)) {
    rosterByRoute[key].sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="mb-1 text-lg font-bold">🚌 실시간 셔틀</h1>
      <p className="mb-4 text-xs text-slate-500">
        등원·하원 노선의 실시간 위치와 탑승 현황입니다. 하원 차량이 학교에 도착하면 &apos;현장도착&apos;을 눌러 학생들에게 안내해주세요.
      </p>
      <ShuttleLiveClient
        routes={routes}
        pilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []}
        rosterByRoute={rosterByRoute}
        userLabel={me.name || me.email}
      />
    </div>
  );
}
