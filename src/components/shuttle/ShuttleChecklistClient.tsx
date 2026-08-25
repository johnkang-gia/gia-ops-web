"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import ShuttleChecklistTable, { effectiveRouteId } from "./ShuttleChecklistTable";
import ChecklistPrintSheet from "./ChecklistPrintSheet";
import ShuttleChecklistSidebar, { type ChangedRouteEntry } from "./ShuttleChecklistSidebar";
import type { GoogleChatMirrorMessage } from "@/lib/types";
import type { RosterStudent } from "@/lib/attendanceDigest";

// 실시간 반영을 postgres_changes로 하더라도, 네트워크가 잠깐 끊기는 등의 이유로 이벤트를
// 놓칠 수 있어(요청: "하원체크표에 표시하면 실시간으로 반영되도록") 안전망으로 느슨한 폴링을
// 같이 둡니다. 실시간이 정상이면 이 폴링은 사실상 아무 변화도 못 찾고 조용히 지나갑니다.
const FALLBACK_POLL_MS = 20000;

export type ChecklistRoute = {
  id: string;
  route_no: string;
  name: string | null;
  driver_name: string | null;
  // 인쇄본(하원차량 체크표 PDF와 같은 서식)에 쓰는 기사님 연락처·차량번호입니다.
  driver_phone?: string | null;
  vehicle_no?: string | null;
};
export type ChecklistItem = {
  assignmentId: string;
  studentId?: string | null;
  studentName: string;
  stopSeq: number;
  homeRouteId: string; // 정류장 기준 평소(절대 원래) 노선 - 바뀌지 않는 기준점
  permanentRouteId: string | null; // 계속 유지되는 영구 이동 - null이면 homeRouteId 그대로
  overrideRouteId: string | null; // 오늘 하루만의 이동 - null이면 적용 안 됨
  status: "예정" | "탑승" | "미탑승" | "결석" | "픽업";
  note: string | null; // 학생별 특이사항 메모(요청: "특이사항있는 아이들... 메모적을 수 있게")
  // 오늘 요일에 이 차를 타는 학생인지. false면 회색으로 흐리게 보이고, 눌러서 오늘 탑승으로
  // 바꿀 수 있습니다(요청: "안타는 아이도 옅은 회색으로 (...) 눌러서 탑승으로").
  ridingToday?: boolean;
  // 이 학생이 이 차를 타는 요일들(1=월~5=금). 인쇄본에서 PDF처럼 "(월수금)이름"으로 씁니다.
  weekdays?: number[];
  // 지속 특이사항 효과로 이 학생을 요일별 셔틀에서 묶어 볼 때 쓰는 표시용 값들(클라이언트에서
  // 계산해 채웁니다). groupColor: 요일마다 다른 셔틀을 타는 학생을 같은 색 테두리로 묶기 위한
  // 색, individualPickup: 개별하원(셔틀 전면 제외)로 표시.
  groupColor?: string | null;
  individualPickup?: boolean;
};

// 지속 특이사항(요청: 왼쪽 창구에 지속 반영사항을 적으면 오른쪽에 요약으로 뜨고, 차량
// 셔틀도 자동 수정되며, 삭제하면 원래 셔틀로 복귀). effectKind가 셔틀을 어떻게 바꾸는지 정합니다.
export type PersistentNote = {
  id: string;
  studentName: string;
  studentId: string | null;
  routeNo: string | null; // 동명이인 구분용(예: "4호")
  content: string;
  effectKind: "none" | "skip_days" | "no_shuttle";
  effectDays: number[]; // skip_days용 (1=월 ... 5=금)
};

// 요일마다 다른 셔틀을 타는 학생을 같은 색으로 묶기 위한 팔레트(테두리·링용). 파스텔 계열로
// 골라, 오늘 타는 셔틀에서는 선명하게, 안 타는 날 셔틀에서는 옅게 보여줍니다.
const GROUP_COLORS = [
  "#0ea5e9", "#f97316", "#8b5cf6", "#10b981", "#ec4899",
  "#eab308", "#ef4444", "#14b8a6", "#6366f1", "#a855f7",
  "#f43f5e", "#22c55e", "#3b82f6", "#d946ef", "#f59e0b",
];

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
  persistentNotes: initialNotes = [],
}: {
  routes: ChecklistRoute[];
  items: ChecklistItem[];
  roster: RosterStudent[];
  initialMessages: GoogleChatMirrorMessage[];
  term: string;
  persistentNotes?: PersistentNote[];
}) {
  const notify = useToast();
  const [items, setItems] = useState(initialItems);
  const [notes, setNotes] = useState<PersistentNote[]>(initialNotes);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [movingBusy, setMovingBusy] = useState(false);

  const assignmentIds = useMemo(() => initialItems.map((i) => i.assignmentId), [initialItems]);
  const assignmentIdsRef = useRef(assignmentIds);
  assignmentIdsRef.current = assignmentIds;

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);

  // 지속 특이사항의 효과와 "요일별 다른 셔틀 색 묶음"을 실제 items에 덧씌운 표시용 목록입니다
  // (요청: 적으면 차량 셔틀 자동 수정 + 요일마다 다른 셔틀 타는 아이는 같은 색 테두리로 묶고
  // 오늘 타는 셔틀은 선명, 안 타는 날은 옅게 전부 보이게). notes를 지우면 자동으로 원래대로
  // 돌아오도록, 파괴적 수정 없이 여기서 계산만 합니다.
  const normName = (s: string) => (s ?? "").replace(/\s+/g, "").trim();
  const displayItems: ChecklistItem[] = useMemo(() => {
    // 요일별로 다른 노선(homeRouteId)에 배정된 같은 학생을 찾아 색을 배정합니다.
    const routesByKey = new Map<string, Set<string>>();
    for (const it of items) {
      const key = it.studentId ?? `n:${normName(it.studentName)}`;
      const set = routesByKey.get(key) ?? new Set<string>();
      set.add(it.homeRouteId);
      routesByKey.set(key, set);
    }
    const colorByKey = new Map<string, string>();
    let ci = 0;
    for (const [key, set] of routesByKey) {
      if (set.size > 1) {
        colorByKey.set(key, GROUP_COLORS[ci % GROUP_COLORS.length]);
        ci += 1;
      }
    }
    const routeNoOf = (routeId: string) => routeById.get(routeId)?.route_no ?? "";
    const todayW = new Date().getDay();
    const matches = (note: PersistentNote, it: ChecklistItem) => {
      if (note.studentId && it.studentId) {
        if (note.studentId !== it.studentId) return false;
      } else if (normName(note.studentName) !== normName(it.studentName)) {
        return false;
      }
      if (note.routeNo) return routeNoOf(it.homeRouteId).replace(/\s+/g, "") === note.routeNo.replace(/[호\s]/g, "");
      return true;
    };
    return items.map((it) => {
      const key = it.studentId ?? `n:${normName(it.studentName)}`;
      let riding = it.ridingToday;
      let individual = false;
      for (const note of notes) {
        if (!matches(note, it)) continue;
        if (note.effectKind === "no_shuttle") {
          individual = true;
          riding = false;
        } else if (note.effectKind === "skip_days" && note.effectDays.includes(todayW)) {
          riding = false;
        }
      }
      return { ...it, ridingToday: riding, individualPickup: individual, groupColor: colorByKey.get(key) ?? null };
    });
  }, [items, notes, routeById]);

  // 오늘 실제로 자리에 남는 인원(픽업·결석은 셔틀을 안 타므로 뺍니다) - 요청: "탑승예정인원이
  // 나타나도록".
  const expectedCount = useMemo(
    () =>
      displayItems.filter(
        (i) => (i.ridingToday !== false || i.status === "탑승") && i.status !== "픽업" && i.status !== "결석"
      ).length,
    [displayItems]
  );

  // shuttle_boardings(오늘 하루 상태·오늘만 이동)와 shuttle_assignments(영구 이동)를 각각
  // realtime으로 구독해서, 다른 사람이 체크표를 바꾸면 폴링을 기다리지 않고 바로 반영합니다
  // (요청: "하원체크표에 표시하면 실시간으로 반영되도록"). 처음에는 이벤트가 오면 두 테이블을
  // 통째로 다시 조회했는데(reload), 그러면 "실시간으로 바뀌었다는 신호"를 받고도 서버 왕복을
  // 한 번 더 기다려야 해서 체감 속도가 느렸습니다. postgres_changes 이벤트에는 바뀐 행의
  // 실제 값이 이미 담겨 오므로, 그 값을 곧장 items에 반영해 서버 왕복 없이 즉시 갱신합니다
  // (요청: "실시간 반영 속도 더 개선"). shuttle_boardings 행은 이 화면에서 항상 upsert만
  // 하고 지우지 않으므로 DELETE는 사실상 발생하지 않지만, 혹시 모를 경우를 위해 안전하게
  // "예정"으로 되돌립니다. 재연결처럼 이벤트를 놓칠 수 있는 상황에 대비해 느슨한 전체 재조회
  // 폴링도 안전망으로 남겨둡니다.
  useEffect(() => {
    if (assignmentIdsRef.current.length === 0) return;
    const supabase = createClient();
    const ids = assignmentIdsRef.current;
    const idSet = new Set(ids);
    const idFilter = `id=in.(${ids.join(",")})`;
    const today = todayStr();

    async function fullReload() {
      const [{ data: boardings }, { data: assignments }] = await Promise.all([
        supabase.from("shuttle_boardings").select("assignment_id, status, override_route_id").eq("service_date", today).in("assignment_id", ids),
        supabase.from("shuttle_assignments_basic").select("id, override_route_id, note").in("id", ids),
      ]);
      const boardingByAssignment = new Map((boardings ?? []).map((b) => [b.assignment_id, b]));
      const assignmentById = new Map((assignments ?? []).map((a) => [a.id, a]));
      setItems((prev) =>
        prev.map((it) => {
          const b = boardingByAssignment.get(it.assignmentId);
          const a = assignmentById.get(it.assignmentId);
          return {
            ...it,
            // 토들에서 자동으로 온 픽업/결석은 boarding 행이 없습니다 - 안전망 재조회가 이를
            // 지우지 않도록, boarding이 없으면 기존 픽업/결석 상태를 유지합니다(사람이 직접 바꾸면
            // boarding 행이 생겨 그 값이 우선합니다).
            status:
              (b?.status as ChecklistItem["status"]) ??
              (it.status === "픽업" || it.status === "결석" ? it.status : "예정"),
            overrideRouteId: b?.override_route_id ?? null,
            permanentRouteId: a ? (a.override_route_id as string | null) : it.permanentRouteId,
            note: a ? ((a.note as string | null) ?? null) : it.note,
          };
        })
      );
    }

    const channel = supabase
      .channel(`shuttle-checklist-${term}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shuttle_boardings", filter: `service_date=eq.${today}` },
        (payload) => {
          const isDelete = payload.eventType === "DELETE";
          const row = (isDelete ? payload.old : payload.new) as
            | { assignment_id?: string; status?: string; override_route_id?: string | null }
            | undefined;
          const assignmentId = row?.assignment_id;
          if (!assignmentId || !idSet.has(assignmentId)) return;
          setItems((prev) =>
            prev.map((it) =>
              it.assignmentId === assignmentId
                ? {
                    ...it,
                    status: isDelete ? "예정" : ((row?.status as ChecklistItem["status"]) ?? "예정"),
                    overrideRouteId: isDelete ? null : (row?.override_route_id ?? null),
                  }
                : it
            )
          );
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_assignments", filter: idFilter }, (payload) => {
        const row = payload.new as { id?: string; override_route_id?: string | null; note?: string | null } | undefined;
        if (!row?.id) return;
        setItems((prev) =>
          prev.map((it) => (it.assignmentId === row.id ? { ...it, permanentRouteId: row.override_route_id ?? null, note: row.note ?? null } : it))
        );
      })
      .subscribe();

    const t = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") void fullReload(); }, FALLBACK_POLL_MS);
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
      // shuttle_assignments는 노선관리 같은 마스터데이터라 RLS가 행정직원·관리자 쓰기만 허용하는데,
      // 체크표는 동승 선생님을 포함한 로그인 사용자 전체가 쓰는 화면이라 전용 API로 우회합니다
      // (요청: "계속 수정이면 계속 바뀐그대로 고정해주고").
      const [assignmentRes] = await Promise.all([
        fetch("/api/shuttle/checklist/assignment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId, permanentRouteId: nextPermanent }),
        }),
        // 계속 유지로 바꾸는 순간, 남아있던 "오늘만" 이동은 헷갈리지 않도록 함께 정리합니다.
        supabase.from("shuttle_boardings").update({ override_route_id: null }).eq("service_date", todayStr()).eq("assignment_id", assignmentId),
      ]);
      if (!assignmentRes.ok) {
        const body = await assignmentRes.json().catch(() => ({}));
        notify("노선 이동을 저장하지 못했습니다: " + (body.error ?? assignmentRes.statusText), "error");
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

  // 뱃지 코너의 메모 아이콘으로 학생별 특이사항을 적습니다(요청: "특이사항있는 아이들
  // 아이들별로 뱃지 코너에 메모적을 수 있게"). shuttle_assignments.note에 저장되고,
  // shuttle_assignments가 admin/행정직원 전용 RLS라 노선이동과 같은 전용 API를 씁니다.
  const [noteEditor, setNoteEditor] = useState<{ assignmentId: string; studentName: string; note: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);

  function openNoteEditor(assignmentId: string) {
    const item = items.find((i) => i.assignmentId === assignmentId);
    if (!item) return;
    setNoteEditor({ assignmentId, studentName: item.studentName, note: item.note ?? "" });
  }

  async function saveNote() {
    if (!noteEditor) return;
    const { assignmentId, note } = noteEditor;
    const trimmed = note.trim();
    const prev = items.find((i) => i.assignmentId === assignmentId)?.note ?? null;
    setNoteBusy(true);
    setItems((cur) => cur.map((it) => (it.assignmentId === assignmentId ? { ...it, note: trimmed || null } : it)));
    const res = await fetch("/api/shuttle/checklist/assignment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId, note: trimmed }),
    });
    setNoteBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      notify("메모를 저장하지 못했습니다: " + (body.error ?? res.statusText), "error");
      setItems((cur) => cur.map((it) => (it.assignmentId === assignmentId ? { ...it, note: prev } : it)));
      return;
    }
    notify(trimmed ? "특이사항을 저장했습니다." : "특이사항을 지웠습니다.", "success");
    setNoteEditor(null);
  }

  // 사이드바 특이사항 위젯용 - "학생이름: 메모" 형태로 정리합니다(요청: "학생이름: 메모 이렇게
  // 정리되도록").
  const specialNotes = useMemo(
    () =>
      items
        .filter((it) => !!it.note && it.note.trim().length > 0)
        .map((it) => ({ key: it.assignmentId, studentName: it.studentName, note: it.note as string }))
        .sort((a, b) => a.studentName.localeCompare(b.studentName, "ko")),
    [items]
  );

  // 이름을 치면 그 학생 뱃지를 바로 찾을 수 있게(요청: "검색할수 있게 해줘서 이름을 치면 그
  // 학생 이름뱃지 바로 찾을 수 있게... 색이 변해서 어디있는지 바로 알 수 있게끔") - 실제
  // 하이라이트·스크롤은 ShuttleChecklistTable이 이 검색어를 받아 처리합니다.
  const [searchTerm, setSearchTerm] = useState("");

  // 지속 특이사항 - 왼쪽 창구에서 새로 적으면 저장하고, 오른쪽 요약에서 지우면(=원래 셔틀로
  // 복귀) active를 false로 내립니다. RLS가 로그인 사용자 전체 쓰기를 허용해 클라이언트에서
  // 바로 씁니다(픽업/결석 토글과 같은 정책). 다른 사람이 적은 것도 보이도록 realtime 구독을
  // 함께 둡니다.
  const [noteBusyPersist, setNoteBusyPersist] = useState(false);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`shuttle-persistent-notes-${term}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shuttle_persistent_notes", filter: `term=eq.${term}` },
        async () => {
          const { data } = await supabase
            .from("shuttle_persistent_notes")
            .select("id, student_name, student_id, route_no, content, effect_kind, effect_days")
            .eq("term", term)
            .eq("active", true)
            .order("created_at", { ascending: false });
          setNotes(
            (data ?? []).map((n) => ({
              id: n.id as string,
              studentName: (n.student_name as string) ?? "",
              studentId: (n.student_id as string | null) ?? null,
              routeNo: (n.route_no as string | null) ?? null,
              content: (n.content as string) ?? "",
              effectKind: (n.effect_kind as PersistentNote["effectKind"]) ?? "none",
              effectDays: (n.effect_days as number[] | null) ?? [],
            }))
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [term]);

  async function addPersistentNote(input: {
    studentName: string;
    routeNo: string | null;
    content: string;
    effectKind: PersistentNote["effectKind"];
    effectDays: number[];
  }) {
    const studentName = input.studentName.trim();
    if (!studentName) {
      notify("학생 이름을 입력해주세요.", "error");
      return false;
    }
    if (!input.content.trim()) {
      notify("내용을 입력해주세요.", "error");
      return false;
    }
    if (input.effectKind === "skip_days" && input.effectDays.length === 0) {
      notify("제외할 요일을 하나 이상 골라주세요.", "error");
      return false;
    }
    setNoteBusyPersist(true);
    const supabase = createClient();
    const matched = items.find((it) => normName(it.studentName) === normName(studentName));
    const { data, error } = await supabase
      .from("shuttle_persistent_notes")
      .insert({
        term,
        student_name: studentName,
        student_id: matched?.studentId ?? null,
        route_no: input.routeNo?.trim() || null,
        content: input.content.trim().slice(0, 300),
        effect_kind: input.effectKind,
        effect_days: input.effectKind === "skip_days" ? input.effectDays : [],
        created_by: "체크표",
      })
      .select("id, student_name, student_id, route_no, content, effect_kind, effect_days")
      .single();
    setNoteBusyPersist(false);
    if (error || !data) {
      notify("특이사항을 저장하지 못했습니다: " + (error?.message ?? "알 수 없는 오류"), "error");
      return false;
    }
    setNotes((prev) => [
      {
        id: data.id as string,
        studentName: data.student_name as string,
        studentId: (data.student_id as string | null) ?? null,
        routeNo: (data.route_no as string | null) ?? null,
        content: data.content as string,
        effectKind: (data.effect_kind as PersistentNote["effectKind"]) ?? "none",
        effectDays: (data.effect_days as number[] | null) ?? [],
      },
      ...prev,
    ]);
    notify("지속 특이사항을 추가했습니다.", "success");
    return true;
  }

  async function removePersistentNote(id: string) {
    const prev = notes;
    setNotes((cur) => cur.filter((n) => n.id !== id));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_persistent_notes").update({ active: false }).eq("id", id);
    if (error) {
      notify("삭제하지 못했습니다: " + error.message, "error");
      setNotes(prev);
      return;
    }
    notify("특이사항을 지우고 원래 셔틀로 되돌렸습니다.", "success");
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
        specialNotes={specialNotes}
        className="print:hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
        onSelectStudentName={setSearchTerm}
        onAddPersistentNote={addPersistentNote}
        persistNoteBusy={noteBusyPersist}
      />
      <div className="min-w-0 flex-1">
        {notes.length > 0 && (
          <div className="mb-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 print:border-black print:bg-white">
            <p className="mb-1.5 text-[11px] font-bold text-orange-700">📌 지속 특이사항 {notes.length}건 (셔틀 자동 반영 중)</p>
            <div className="flex flex-wrap gap-1.5">
              {notes.map((n) => {
                const effLabel =
                  n.effectKind === "no_shuttle"
                    ? "개별하원(셔틀 안 탐)"
                    : n.effectKind === "skip_days"
                      ? `${n.effectDays.map((d) => "일월화수목금토"[d]).join("")}요일 셔틀 제외`
                      : "메모";
                return (
                  <span
                    key={n.id}
                    className="group relative inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-white px-2 py-1 text-[11px] text-orange-900"
                  >
                    <span className="font-bold">
                      {n.studentName}
                      {n.routeNo ? `(${n.routeNo})` : ""}
                    </span>
                    <span className="text-orange-700">· {n.content}</span>
                    <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">{effLabel}</span>
                    <button
                      type="button"
                      onClick={() => setNoteMenuId((cur) => (cur === n.id ? null : n.id))}
                      title="지우기(원래 셔틀로 복귀)"
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 print:hidden"
                    >
                      ⋯
                    </button>
                    {noteMenuId === n.id && (
                      <span className="absolute right-0 top-full z-10 mt-1 flex flex-col rounded-lg border border-slate-200 bg-white p-1 shadow-lg print:hidden">
                        <button
                          type="button"
                          disabled={noteBusyPersist}
                          onClick={() => {
                            setNoteMenuId(null);
                            removePersistentNote(n.id);
                          }}
                          className="whitespace-nowrap rounded px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          🗑 삭제하고 원래 셔틀로
                        </button>
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 print:border-black">
          <span>
            📅 {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })} · 🧒 탑승예정{" "}
            <span className="text-sm font-bold text-slate-800">{expectedCount}</span>명
          </span>
          <div className="flex items-center gap-1.5 print:hidden">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 학생 이름 검색"
              className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-400 sm:w-40"
            />
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              🖨 인쇄
            </button>
          </div>
        </div>
        {/* 화면용 표(드래그·버튼·색상)는 인쇄에서 감추고, 아래 인쇄 전용 표만 나갑니다
            (요청: 보내주신 하원차량 체크 PDF와 같은 서식으로 인쇄되도록). */}
        <div className="print:hidden">
          <ShuttleChecklistTable
            routes={routes}
            items={displayItems}
            busyId={busyId}
            searchTerm={searchTerm}
            onSetStatus={setStatus}
            onRequestMove={requestMove}
            onRequestEditNote={openNoteEditor}
          />
        </div>
        <ChecklistPrintSheet
          routes={routes}
          items={displayItems}
          dateLabel={new Date().toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }).replace(/\.\s*$/, "").replace(". ", "월 ") + "일"}
        />
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

      {noteEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <p className="mb-2 text-sm font-bold text-slate-800">{noteEditor.studentName} 학생 특이사항</p>
            <textarea
              value={noteEditor.note}
              onChange={(e) => setNoteEditor((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
              placeholder="예: 땅콩 알레르기, 하차 시 보호자 직접 확인 필요 등"
              rows={3}
              className="mb-3 w-full resize-none rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-blue-400"
              autoFocus
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={noteBusy}
                onClick={saveNote}
                className="flex-1 rounded-lg bg-gia-navy px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                저장
              </button>
              <button
                type="button"
                disabled={noteBusy}
                onClick={() => setNoteEditor(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
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
