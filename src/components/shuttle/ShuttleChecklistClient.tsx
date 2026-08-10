"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

const POLL_MS = 8000;

export type ChecklistRoute = { id: string; route_no: string; name: string | null; driver_name: string | null };
export type ChecklistRosterItem = {
  assignmentId: string;
  studentName: string;
  stopSeq: number;
  status: "예정" | "탑승" | "미탑승" | "결석" | "픽업";
};

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// PDF(하원차량 체크표)와 같은 형태의 노선별 학생 명단 표입니다. 이름을 누르면 "픽업"(부모님이
// 직접 데려가심)으로 바뀌고, shuttle_boardings에 바로 저장됩니다 - RLS가 로그인한 교직원 전체의
// 쓰기를 허용해서(giamicro_all_shuttle_boardings), 별도 토큰 없이 세션으로 바로 기록됩니다.
// 다른 화면(실시간 셔틀·안내보드)도 같은 테이블을 폴링해서 읽으므로, 몇 초 안에 그쪽에도
// 반영됩니다(요청: "픽업으로 전환하면 바로 실시간 셔틀 판에 반영되도록").
export default function ShuttleChecklistClient({
  routes,
  rosterByRoute: initialRosterByRoute,
}: {
  routes: ChecklistRoute[];
  rosterByRoute: Record<string, ChecklistRosterItem[]>;
}) {
  const notify = useToast();
  const [rosterByRoute, setRosterByRoute] = useState(initialRosterByRoute);
  const [busyId, setBusyId] = useState<string | null>(null);

  const allAssignmentIds = useMemo(() => Object.values(initialRosterByRoute).flat().map((r) => r.assignmentId), [initialRosterByRoute]);
  const assignmentIdsRef = useRef(allAssignmentIds);
  assignmentIdsRef.current = allAssignmentIds;

  useEffect(() => {
    if (assignmentIdsRef.current.length === 0) return;
    const supabase = createClient();
    async function poll() {
      const { data } = await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status")
        .eq("service_date", todayStr())
        .in("assignment_id", assignmentIdsRef.current);
      if (!data) return;
      const statusByAssignment = new Map(data.map((b) => [b.assignment_id, b.status]));
      setRosterByRoute((prev) => {
        const next: typeof prev = {};
        for (const key of Object.keys(prev)) {
          next[key] = prev[key].map((r) => ({
            ...r,
            status: (statusByAssignment.get(r.assignmentId) as ChecklistRosterItem["status"]) ?? "예정",
          }));
        }
        return next;
      });
    }
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, []);

  async function togglePickup(routeId: string, item: ChecklistRosterItem) {
    const nextStatus: ChecklistRosterItem["status"] = item.status === "픽업" ? "예정" : "픽업";
    setBusyId(item.assignmentId);
    setRosterByRoute((prev) => ({
      ...prev,
      [routeId]: prev[routeId].map((r) => (r.assignmentId === item.assignmentId ? { ...r, status: nextStatus } : r)),
    }));
    const supabase = createClient();
    const { error } = await supabase
      .from("shuttle_boardings")
      .upsert(
        { service_date: todayStr(), assignment_id: item.assignmentId, status: nextStatus, checked_by: "체크표", checked_at: new Date().toISOString() },
        { onConflict: "service_date,assignment_id" }
      );
    setBusyId(null);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      setRosterByRoute((prev) => ({
        ...prev,
        [routeId]: prev[routeId].map((r) => (r.assignmentId === item.assignmentId ? { ...r, status: item.status } : r)),
      }));
      return;
    }
    notify(nextStatus === "픽업" ? `${item.studentName} 학생을 픽업으로 표시했습니다.` : `${item.studentName} 학생 픽업을 취소했습니다.`, "success");
  }

  const sortedRoutes = useMemo(() => [...routes].sort((a, b) => natCompare(a.route_no, b.route_no)), [routes]);

  if (sortedRoutes.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">노선이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <th className="w-24 px-3 py-2 font-semibold">호차</th>
            <th className="w-32 px-3 py-2 font-semibold">지역</th>
            <th className="w-24 px-3 py-2 font-semibold">기사님</th>
            <th className="px-3 py-2 font-semibold">학생 (누르면 픽업 전환)</th>
          </tr>
        </thead>
        <tbody>
          {sortedRoutes.map((route) => {
            const roster = rosterByRoute[route.id] ?? [];
            return (
              <tr key={route.id} className="border-b border-slate-100 align-top last:border-b-0">
                <td className="px-3 py-2.5 font-bold text-slate-700">{route.route_no}호</td>
                <td className="px-3 py-2.5 text-xs text-slate-600">{route.name ?? ""}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{route.driver_name ?? ""}</td>
                <td className="px-3 py-2.5">
                  {roster.length === 0 ? (
                    <span className="text-xs text-slate-300">배정된 학생 없음</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {roster.map((item) => {
                        const isPickup = item.status === "픽업";
                        const isOther = !isPickup && item.status !== "예정";
                        return (
                          <button
                            key={item.assignmentId}
                            onClick={() => togglePickup(route.id, item)}
                            disabled={busyId === item.assignmentId}
                            title={isOther ? `현재 상태: ${item.status} (눌러서 픽업으로 덮어쓰기)` : undefined}
                            className={
                              "rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40 " +
                              (isPickup
                                ? "border-pink-400 bg-pink-100 text-pink-700 line-through"
                                : isOther
                                  ? "border-slate-300 bg-slate-100 text-slate-500"
                                  : "border-slate-300 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50")
                            }
                          >
                            {isPickup ? "🚗 " : ""}
                            {item.studentName}
                            {isOther ? ` (${item.status})` : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
