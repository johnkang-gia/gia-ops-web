"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import ShuttleChecklistTable, { effectiveRouteId } from "./ShuttleChecklistTable";
import ShuttleChecklistSidebar, { type ChangedRouteEntry } from "./ShuttleChecklistSidebar";
import type { GoogleChatMirrorMessage } from "@/lib/types";
import type { RosterStudent } from "@/lib/attendanceDigest";

// 실시간 반영을 postgres_changes로 하더라도, 네트워크가 잠깐 끊기는 등의 이유로 이벤트를
// 놓칠 수 있어(요청: "하원체크표에 표시하면 실시간으로 반영되도록") 안전망으로 느슨한 폴링을
// 같이 둡니다. 실시간이 정상이면 이 폴링은 사실상 아무 변화도 못 찾고 조용히 지나갑니다.
const FALLBACK_POLL_MS = 20000;

export type ChecklistRoute = { id: string; route_no: string; name: string | null; driver_name: string | null };
export type ChecklistItem = {
  assignmentId: string;
  studentName: string;
  stopSeq: number;
  homeRouteId: string; // 정류장 기준 평소(절대 원래) 노선 - 바뀌지 않는 기준점
  permanentRouteId: string | null; // 계속 유지되는 영구 이동 - null이면 homeRouteId 그대로
  overrideRouteId: string | null; // 오늘 하루만의 이동 - null이면 적용 안 됨
  status: "예정" | "탑승" | "미탑승" | "결석" | "픽업";
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

type PendingMove = { assignmentId: string; studentName: string; targetRouteId: string; targetRouteNo: string; homeRouteNo: string };

// PDF(하원차량 체크표)와 같은 형태의 노선별 학생 명단 화면입니다. 상태(items)와 실시간 동기화,
// 노선 이동 확인창을 이 파일이 관장하고, 실제 표는 ShuttleChecklistTable에, 왼쪽 위젯은
// ShuttleChecklistSidebar에 맡깁니다. 전부 shuttle_boardings/shuttle_assignments에 바로
// 저장되어(RLS가 로그인한 교직원 전체의 쓰기를 허용) 실시간 셔틀·안내보드에도 그대로
// 반영됩니다.
export default function ShuttleChecklistClient({
  routes,
  items: initialItems,
  roster,
  initialMessages,
  term,
}: {
  routes: ChecklistRoute[];
  items: ChecklistItem[];
  roster: RosterStudent[];
  initialMessages: GoogleChatMirrorMessage[];
  term: string;
}) {
  const notify = useToast();
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [movingBusy, setMovingBusy] = useState(false);

  const assignmentIds = useMemo(() => initialItems.map((i) => i.assignmentId), [initialItems]);
  const assignmentIdsRef = useRef(assignmentIds);
  assignmentIdsRef.current = assignmentIds;

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);

  // 오늘 실제로 자리에 남는 인원(픽업·결석은 셔틀을 안 타므로 뺍니다) - 요청: "탑승예정인원이
  // 나타나도록".
  const expectedCount = useMemo(() => items.filter((i) => i.status !== "픽업" && i.status !== "결석").length, [items]);

  // shuttle_boardings(오늘 하루 상태·오늘만 이동)와 shuttle_assignments(영구 이동)를 각각
  // realtime으로 구독해서, 다른 사람이 체크표를 바꾸면 폴링을 기다리지 않고 바로 반영합니다
  // (요청: "하원체크표에 표시하면 실시간으로 반영되도록").
  useEffect(() => {
    if (assignmentIdsRef.current.length === 0) return;
    const supabase = createClient();
    const ids = assignmentIdsRef.current;
    const idFilter = `id=in.(${ids.join(",")})`;

    async function reload() {
      const [{ data: boardings }, { data: assignments }] = await Promise.all([
        supabase
          .from("shuttle_boardings")
          .select("assignment_id, status, override_route_id")
          .eq("service_date", todayStr())
          .in("assignment_id", ids),
        supabase.from("shuttle_assignments").select("id, override_route_id").in("id", ids),
      ]);
      const boardingByAssignment = new Map((boardings ?? []).map((b) => [b.assignment_id, b]));
      const permanentByAssignment = new Map((assignments ?? []).map((a) => [a.id, a.override_route_id as string | null]));
      setItems((prev) =>
        prev.map((it) => {
          const b = boardingByAssignment.get(it.assignmentId);
          return {
            ...it,
            status: (b?.status as ChecklistItem["status"]) ?? "예정",
            overrideRouteId: b?.override_route_id ?? null,
            permanentRouteId: permanentByAssignment.has(it.assignmentId) ? permanentByAssignment.get(it.assignmentId)! : it.permanentRouteId,
          };
        })
      );
    }

    const channel = supabase
      .channel(`shuttle-checklist-${term}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_boardings", filter: `service_date=eq.${todayStr()}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_assignments", filter: idFilter }, () => reload())
      .subscribe();

    const t = setInterval(reload, FALLBACK_POLL_MS);
    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [term]);

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

  // 드래그로 놓으면 바로 옮기지 않고, 계속 유지할지 오늘만 적용할지부터 물어봅니다(요청:
  // "차량을 수정하면 계속 수정된채로 있을건지, 오늘만 차량이 바뀌는 건지 물어보고").
  function requestMove(assignmentId: string, targetRouteId: string) {
    const item = items.find((i) => i.assignmentId === assignmentId);
    if (!item) return;
    if (targetRouteId === effectiveRouteId(item)) return; // 지금 있는 자리에 그대로 놓은 경우
    const targetRoute = routeById.get(targetRouteId);
    const homeRoute = routeById.get(item.homeRouteId);
    setPendingMove({
      assignmentId,
      studentName: item.studentName,
      targetRouteId,
      targetRouteNo: targetRoute?.route_no ?? "?",
      homeRouteNo: homeRoute?.route_no ?? "?",
    });
  }

  async function confirmMove(mode: "today" | "permanent") {
    if (!pendingMove) return;
    const { assignmentId, targetRouteId } = pendingMove;
    const item = items.find((i) => i.assignmentId === assignmentId);
    if (!item) {
      setPendingMove(null);
      return;
    }
    setMovingBusy(true);
    const supabase = createClient();

    if (mode === "today") {
      const baseline = item.permanentRouteId ?? item.homeRouteId;
      const nextOverride = targetRouteId === baseline ? null : targetRouteId;
      const prevOverride = item.overrideRouteId;
      setItems((prev) => prev.map((it) => (it.assignmentId === assignmentId ? { ...it, overrideRouteId: nextOverride } : it)));
      const { error } = await supabase
        .from("shuttle_boardings")
        .upsert({ service_date: todayStr(), assignment_id: assignmentId, override_route_id: nextOverride }, { onConflict: "service_date,assignment_id" });
      if (error) {
        notify("노선 이동을 저장하지 못했습니다: " + error.message, "error");
        setItems((prev) => prev.map((it) => (it.assignmentId === assignmentId ? { ...it, overrideRouteId: prevOverride } : it)));
      } else {
        notify(
          nextOverride ? `${item.studentName} 학생을 오늘만 다른 차량으로 옮겼습니다.` : `${item.studentName} 학생을 원래 노선으로 되돌렸습니다.`,
          "success"
        );
      }
    } else {
      const nextPermanent = targetRouteId === item.homeRouteId ? null : targetRouteId;
      const prevPermanent = item.permanentRouteId;
      const prevOverride = item.overrideRouteId;
      setItems((prev) =>
        prev.map((it) => (it.assignmentId === assignmentId ? { ...it, permanentRouteId: nextPermanent, overrideRouteId: null } : it))
      );
      const [assignmentRes] = await Promise.all([
        supabase.from("shuttle_assignments").update({ override_route_id: nextPermanent }).eq("id", assignmentId),
        // 계속 유지로 바꾸는 순간, 남아있던 "오늘만" 이동은 헷갈리지 않도록 함께 정리합니다.
        supabase.from("shuttle_boardings").update({ override_route_id: null }).eq("service_date", todayStr()).eq("assignment_id", assignmentId),
      ]);
      if (assignmentRes.error) {
        notify("노선 이동을 저장하지 못했습니다: " + assignmentRes.error.message, "error");
        setItems((prev) =>
          prev.map((it) => (it.assignmentId === assignmentId ? { ...it, permanentRouteId: prevPermanent, overrideRouteId: prevOverride } : it))
        );
      } else {
        notify(
          nextPermanent ? `${item.studentName} 학생을 앞으로 계속 다른 차량으로 옮겼습니다.` : `${item.studentName} 학생을 원래 노선으로 되돌렸습니다.`,
          "success"
        );
      }
    }
    setMovingBusy(false);
    setPendingMove(null);
  }

  // 사이드바 세 번째 위젯("오늘 차량 변경")용 - 평소와 다른 노선에 있는 학생만 추려서 보여줍니다.
  const changedToday: ChangedRouteEntry[] = useMemo(() => {
    return items
      .filter((it) => effectiveRouteId(it) !== it.homeRouteId)
      .map((it) => {
        const isToday = !!it.overrideRouteId && it.overrideRouteId !== (it.permanentRouteId ?? it.homeRouteId);
        const toRouteId = effectiveRouteId(it);
        return {
          key: it.assignmentId,
          studentName: it.studentName,
          fromRouteNo: routeById.get(it.homeRouteId)?.route_no ?? "?",
          toRouteNo: routeById.get(toRouteId)?.route_no ?? "?",
          mode: isToday ? ("today" as const) : ("permanent" as const),
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [items, routeById]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <ShuttleChecklistSidebar
        roster={roster}
        initialMessages={initialMessages}
        changedToday={changedToday}
        className="print:hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 print:border-black">
          <span>
            📅 {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })} · 🧒 탑승예정{" "}
            <span className="text-sm font-bold text-slate-800">{expectedCount}</span>명
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 print:hidden"
          >
            🖨 인쇄
          </button>
        </div>
        <ShuttleChecklistTable routes={routes} items={items} busyId={busyId} onSetStatus={setStatus} onRequestMove={requestMove} />
      </div>

      {pendingMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <p className="mb-1 text-sm font-bold text-slate-800">
              {pendingMove.studentName} 학생을 {pendingMove.homeRouteNo}호 → {pendingMove.targetRouteNo}호로 옮길까요?
            </p>
            <p className="mb-4 text-xs text-slate-500">계속 이 노선을 탈지, 오늘 하루만 옮길지 선택해주세요.</p>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={movingBusy}
                onClick={() => confirmMove("permanent")}
                className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                계속 유지 (내일부터도 이 노선)
              </button>
              <button
                type="button"
                disabled={movingBusy}
                onClick={() => confirmMove("today")}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
              >
                오늘만 (내일은 원래대로)
              </button>
              <button
                type="button"
                disabled={movingBusy}
                onClick={() => setPendingMove(null)}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 disabled:opacity-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
