"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShuttlePilotRoute, ShuttleRoute, ShuttleRunEvent } from "@/lib/types";

const POLL_MS = 6000;

export type BoardRosterItem = { assignmentId: string; studentName: string };
type BoardingRow = { assignment_id: string; status: string };

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 복도·로비 화면에 띄워두는 큰 안내보드입니다(요청 3번 답변). 교직원이 현장도착을 체크한
// 하원 차량만 골라, 아직 태워야 할 학생 이름을 큰 글씨로 보여줍니다. 상호작용 없이 보여주기만
// 하고, 다른 화면과 마찬가지로 REST 폴링으로 갱신합니다.
export default function ShuttleBoardClient({
  routes,
  pilots,
  rosterByRoute,
}: {
  routes: ShuttleRoute[];
  pilots: ShuttlePilotRoute[];
  rosterByRoute: Record<string, BoardRosterItem[]>;
}) {
  const [eventsByRoute, setEventsByRoute] = useState<Record<string, ShuttleRunEvent[]>>({});
  const [boardingByAssignment, setBoardingByAssignment] = useState<Record<string, BoardingRow>>({});
  const [clock, setClock] = useState(() => new Date());

  const pilotRouteIds = useMemo(() => pilots.filter((p) => p.enabled).map((p) => p.route_id), [pilots]);
  const assignmentIds = useMemo(() => Object.values(rosterByRoute).flat().map((r) => r.assignmentId), [rosterByRoute]);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (pilotRouteIds.length === 0 && assignmentIds.length === 0) return;
    const supabase = createClient();

    async function poll() {
      const today = todayStr();
      const [eventsRes, boardingsRes] = await Promise.all([
        pilotRouteIds.length > 0
          ? supabase.from("shuttle_run_events").select("*").in("route_id", pilotRouteIds).eq("service_date", today).order("created_at", { ascending: true })
          : Promise.resolve({ data: [] as ShuttleRunEvent[] }),
        assignmentIds.length > 0
          ? supabase.from("shuttle_boardings").select("assignment_id, status").eq("service_date", today).in("assignment_id", assignmentIds)
          : Promise.resolve({ data: [] as BoardingRow[] }),
      ]);

      const evByRoute: Record<string, ShuttleRunEvent[]> = {};
      for (const e of (eventsRes.data as ShuttleRunEvent[] | null) ?? []) {
        (evByRoute[e.route_id] ??= []).push(e);
      }
      setEventsByRoute(evByRoute);

      const boardMap: Record<string, BoardingRow> = {};
      for (const b of (boardingsRes.data as BoardingRow[] | null) ?? []) {
        boardMap[b.assignment_id] = b;
      }
      setBoardingByAssignment(boardMap);
    }

    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [pilotRouteIds, assignmentIds]);

  // 오늘 '현장도착'이 찍혔고 아직 '출발'은 안 한 노선만 안내보드에 띄웁니다 - 지금 당장
  // 태워야 하는 차량만 보여주는 게 목적이라, 아직 학교에 안 왔거나 이미 떠난 차량은 뺍니다.
  const boardingRoutes = useMemo(() => {
    return routes
      .filter((r) => {
        const events = eventsByRoute[r.id] ?? [];
        const arrived = events.find((e) => e.event === "현장도착");
        const departed = events.some((e) => e.event === "출발");
        return arrived && !departed;
      })
      .sort((a, b) => natCompare(a.route_no, b.route_no));
  }, [routes, eventsByRoute]);

  return (
    <div className="min-h-screen bg-slate-900 px-6 py-8 text-white sm:px-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-black sm:text-4xl">🚌 하원 셔틀 탑승 안내</h1>
        <p className="text-xl font-bold text-slate-300 sm:text-3xl">
          {clock.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
      </div>

      {boardingRoutes.length === 0 ? (
        <div className="flex h-[50vh] items-center justify-center">
          <p className="text-2xl font-bold text-slate-500 sm:text-4xl">현재 도착해서 대기 중인 차량이 없습니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {boardingRoutes.map((route) => {
            const arrivedEvent = (eventsByRoute[route.id] ?? []).find((e) => e.event === "현장도착")!;
            const roster = rosterByRoute[route.id] ?? [];
            const waiting = roster.filter((r) => (boardingByAssignment[r.assignmentId]?.status ?? "예정") !== "탑승");
            const boarded = roster.filter((r) => boardingByAssignment[r.assignmentId]?.status === "탑승");
            return (
              <div key={route.id} className="rounded-2xl border-4 border-amber-400 bg-slate-800 p-6">
                <div className="mb-4 flex items-baseline justify-between">
                  <p className="text-3xl font-black text-amber-300 sm:text-5xl">
                    {route.route_no}호차 {route.name ?? ""}
                  </p>
                  <p className="text-lg font-semibold text-slate-400">{fmtTime(arrivedEvent.created_at)} 도착</p>
                </div>
                {waiting.length === 0 ? (
                  <p className="text-2xl font-bold text-emerald-400">✅ 전원 탑승 완료</p>
                ) : (
                  <p className="flex flex-wrap gap-3 text-2xl font-bold leading-relaxed sm:text-3xl">
                    {waiting.map((r) => (
                      <span key={r.assignmentId}>{r.studentName}</span>
                    ))}
                  </p>
                )}
                {boarded.length > 0 && (
                  <p className="mt-4 text-base text-slate-400">
                    탑승완료 {boarded.length}명: {boarded.map((r) => r.studentName).join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
