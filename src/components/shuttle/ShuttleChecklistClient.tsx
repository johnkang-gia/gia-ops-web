"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

const POLL_MS = 8000;

export type ChecklistRoute = { id: string; route_no: string; name: string | null; driver_name: string | null };
export type ChecklistItem = {
  assignmentId: string;
  studentName: string;
  stopSeq: number;
  naturalRouteId: string; // 평소 배정된 노선
  overrideRouteId: string | null; // 오늘 하루만 다른 노선을 타는 경우(null이면 평소 노선 그대로)
  status: "예정" | "탑승" | "미탑승" | "결석" | "픽업";
};

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// PDF(하원차량 체크표)와 같은 형태의 노선별 학생 명단 표입니다. 이름을 드래그해서 다른 노선
// 칸에 놓으면 오늘 하루만 그 차를 타는 것으로 바뀌고(요청: "표안에서 아이들의 이름을 자유롭게
// 끌어서 이동할 수 있게"), 🚗(픽업)·🚫(결석) 버튼으로 상태를 표시합니다. 전부 shuttle_boardings에
// 바로 저장되어(RLS가 로그인한 교직원 전체의 쓰기를 허용) 실시간 셔틀·안내보드에도 반영됩니다.
export default function ShuttleChecklistClient({ routes, items: initialItems }: { routes: ChecklistRoute[]; items: ChecklistItem[] }) {
  const notify = useToast();
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragOverRoute, setDragOverRoute] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);

  const assignmentIds = useMemo(() => initialItems.map((i) => i.assignmentId), [initialItems]);
  const assignmentIdsRef = useRef(assignmentIds);
  assignmentIdsRef.current = assignmentIds;

  useEffect(() => {
    if (assignmentIdsRef.current.length === 0) return;
    const supabase = createClient();
    async function poll() {
      const { data } = await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status, override_route_id")
        .eq("service_date", todayStr())
        .in("assignment_id", assignmentIdsRef.current);
      if (!data) return;
      const byAssignment = new Map(data.map((b) => [b.assignment_id, b]));
      setItems((prev) =>
        prev.map((it) => {
          const b = byAssignment.get(it.assignmentId);
          return {
            ...it,
            status: (b?.status as ChecklistItem["status"]) ?? "예정",
            overrideRouteId: b?.override_route_id ?? null,
          };
        })
      );
    }
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, []);

  async function setStatus(item: ChecklistItem, nextStatus: ChecklistItem["status"]) {
    const finalStatus = item.status === nextStatus ? "예정" : nextStatus;
    setBusyId(item.assignmentId);
    setItems((prev) => prev.map((it) => (it.assignmentId === item.assignmentId ? { ...it, status: finalStatus } : it)));
    const supabase = createClient();
    const { error } = await supabase
      .from("shuttle_boardings")
      .upsert(
        { service_date: todayStr(), assignment_id: item.assignmentId, status: finalStatus, checked_by: "체크표", checked_at: new Date().toISOString() },
        { onConflict: "service_date,assignment_id" }
      );
    setBusyId(null);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      setItems((prev) => prev.map((it) => (it.assignmentId === item.assignmentId ? { ...it, status: item.status } : it)));
    }
  }

  async function moveToRoute(assignmentId: string, targetRouteId: string) {
    const item = items.find((i) => i.assignmentId === assignmentId);
    if (!item) return;
    const nextOverride = targetRouteId === item.naturalRouteId ? null : targetRouteId;
    if (nextOverride === item.overrideRouteId) return; // 같은 자리에 놓은 경우 - 아무것도 안 함
    const prevOverride = item.overrideRouteId;
    setItems((prev) => prev.map((it) => (it.assignmentId === assignmentId ? { ...it, overrideRouteId: nextOverride } : it)));
    const supabase = createClient();
    const { error } = await supabase
      .from("shuttle_boardings")
      .upsert(
        { service_date: todayStr(), assignment_id: assignmentId, override_route_id: nextOverride },
        { onConflict: "service_date,assignment_id" }
      );
    if (error) {
      notify("노선 이동을 저장하지 못했습니다: " + error.message, "error");
      setItems((prev) => prev.map((it) => (it.assignmentId === assignmentId ? { ...it, overrideRouteId: prevOverride } : it)));
      return;
    }
    notify(
      nextOverride
        ? `${item.studentName} 학생을 오늘만 다른 차량으로 옮겼습니다.`
        : `${item.studentName} 학생을 원래 노선으로 되돌렸습니다.`,
      "success"
    );
  }

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const sortedRoutes = useMemo(() => [...routes].sort((a, b) => natCompare(a.route_no, b.route_no)), [routes]);

  const itemsByRoute = useMemo(() => {
    const map: Record<string, ChecklistItem[]> = {};
    for (const it of items) {
      const routeId = it.overrideRouteId && routeById.has(it.overrideRouteId) ? it.overrideRouteId : it.naturalRouteId;
      (map[routeId] ??= []).push(it);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));
    }
    return map;
  }, [items, routeById]);

  if (sortedRoutes.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">노선이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <th className="w-24 px-3 py-2 font-semibold">호차</th>
            <th className="w-32 px-3 py-2 font-semibold">지역</th>
            <th className="w-24 px-3 py-2 font-semibold">기사님</th>
            <th className="px-3 py-2 font-semibold">학생 (이름 드래그로 노선 이동 · 🚗픽업 · 🚫결석)</th>
          </tr>
        </thead>
        <tbody>
          {sortedRoutes.map((route) => {
            const roster = itemsByRoute[route.id] ?? [];
            const isDragOver = dragOverRoute === route.id;
            return (
              <tr key={route.id} className="border-b border-slate-100 align-top last:border-b-0">
                <td className="px-3 py-2.5 font-bold text-slate-700">{route.route_no}호</td>
                <td className="px-3 py-2.5 text-xs text-slate-600">{route.name ?? ""}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{route.driver_name ?? ""}</td>
                <td
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverRoute(route.id);
                  }}
                  onDragLeave={() => setDragOverRoute((prev) => (prev === route.id ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverRoute(null);
                    const assignmentId = draggingIdRef.current ?? e.dataTransfer.getData("text/plain");
                    if (assignmentId) moveToRoute(assignmentId, route.id);
                  }}
                  className={"px-3 py-2.5 transition-colors " + (isDragOver ? "bg-blue-50 outline outline-2 outline-blue-300 -outline-offset-2" : "")}
                >
                  {roster.length === 0 ? (
                    <span className="text-xs text-slate-300">{isDragOver ? "여기로 놓으면 이 노선으로 이동" : "배정된 학생 없음"}</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {roster.map((item) => {
                        const isPickup = item.status === "픽업";
                        const isAbsent = item.status === "결석";
                        const isMoved = !!item.overrideRouteId && item.overrideRouteId !== item.naturalRouteId;
                        const naturalRoute = routeById.get(item.naturalRouteId);
                        return (
                          <div
                            key={item.assignmentId}
                            draggable
                            onDragStart={(e) => {
                              draggingIdRef.current = item.assignmentId;
                              e.dataTransfer.setData("text/plain", item.assignmentId);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              draggingIdRef.current = null;
                              setDragOverRoute(null);
                            }}
                            title={isMoved ? `평소 노선: ${naturalRoute?.route_no ?? "?"}호 (오늘만 이동됨 - 드래그해서 되돌릴 수 있어요)` : "드래그해서 다른 노선으로 이동"}
                            className={
                              "flex cursor-grab select-none flex-col items-center gap-0.5 rounded-lg border px-2 py-1 text-xs font-semibold active:cursor-grabbing " +
                              (isAbsent
                                ? "border-red-300 bg-red-50 text-red-500 line-through"
                                : isPickup
                                  ? "border-pink-400 bg-pink-100 text-pink-700"
                                  : isMoved
                                    ? "border-amber-400 bg-amber-50 text-amber-700"
                                    : "border-slate-300 bg-white text-slate-700")
                            }
                          >
                            <span>
                              {isMoved && "↔ "}
                              {item.studentName}
                            </span>
                            <span className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setStatus(item, "픽업")}
                                disabled={busyId === item.assignmentId}
                                title="픽업(부모님이 직접 데려가심)"
                                className={
                                  "rounded px-1 text-[10px] disabled:opacity-40 " +
                                  (isPickup ? "bg-pink-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-pink-100")
                                }
                              >
                                🚗
                              </button>
                              <button
                                type="button"
                                onClick={() => setStatus(item, "결석")}
                                disabled={busyId === item.assignmentId}
                                title="결석"
                                className={
                                  "rounded px-1 text-[10px] disabled:opacity-40 " +
                                  (isAbsent ? "bg-red-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-red-100")
                                }
                              >
                                🚫
                              </button>
                            </span>
                          </div>
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
