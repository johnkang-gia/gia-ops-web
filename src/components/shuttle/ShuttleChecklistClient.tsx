"use client";

import { todayKst } from "@/lib/kst";
import { buildHomonymSet, normName as normStudentName, whereLabel } from "@/lib/studentLabel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logChecklist, type ChecklistLogRow, type LogActor } from "@/lib/checklistLog";
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
// 픽업·결석이 **자동으로** 붙은 경우, 그 근거가 된 연락 한 건.
//
// 담당자: "자동으로 분류되는 거 이유가 뭔지 보고 싶어."
// 근거가 결과 옆에 없으면 사람은 결과를 못 믿고, 매번 인박스로 넘어가 다시 찾게 됩니다.
export type AutoSource = {
  requestId: string;
  kind: "픽업" | "결석";
  /** '토들' | '구글챗' | '전화' | '교사' | '직접입력' | '학부모링크' */
  source: string;
  channelLabel: string | null;
  senderName: string | null;
  receivedAt: string;
  rawText: string;
  /** AI가 남긴 판단 근거 한 줄. */
  aiNote: string | null;
  matchedName: string | null;
  sourceUrl: string | null;
  sourceChatId: string | null;
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
  /** 픽업·결석이 자동으로 붙었다면 그 근거. 사람이 직접 누른 경우에는 null입니다. */
  autoSource?: AutoSource | null;
  /**
   * 오늘 요일의 하원수단이 셔틀이 아닐 때 그 내용(학생 프로필의 🏠 하원수단).
   *
   * 요일마다 다른 차를 타는 아이가 있습니다. 그 아이는 셔틀 배정이 그대로 살아 있어서
   * 체크표에는 계속 "탄다"로 떴습니다. 아무도 안 누르면 기사님은 오지 않는 아이를 기다리고,
   * 담임은 아이를 셔틀 줄에 세웁니다. 학생 프로필에 이미 적힌 사실이 화면에 닿지 않은
   * 것뿐이라 여기서 이어 붙입니다.
   */
  dismissalPlan?: { kind: string; label: string | null; departTime: string | null } | null;
};

// 지속 특이사항(요청: 왼쪽 창구에 지속 반영사항을 적으면 오른쪽에 요약으로 뜨고, 차량
// 셔틀도 자동 수정되며, 삭제하면 원래 셔틀로 복귀). effectKind가 셔틀을 어떻게 바꾸는지 정합니다.
export type PersistentNote = {
  id: string;
  studentName: string;
  studentId: string | null;
  routeNo: string | null; // 동명이인 구분용(예: "4호")
  content: string;
  // 'absent'·'pickup'은 **날짜 기간**으로 걸리는 효과입니다(예: 9/23~9/28 가족여행 결석).
  // 표에는 예전부터 있었는데(20260827200000) 이 화면이 안 읽고 있었습니다 - AI 수집기가
  // 학부모 연락에서 뽑아 저장해도 체크표에는 그 아이가 그대로 타는 것으로 떴습니다.
  effectKind: "none" | "skip_days" | "no_shuttle" | "absent" | "pickup";
  effectDays: number[]; // skip_days용 (1=월 ... 5=금)
  /** 기간의 시작·끝(YYYY-MM-DD). 없으면 기간 제한 없음. */
  effectFrom?: string | null;
  effectTo?: string | null;
};

// 요일마다 다른 셔틀을 타는 학생을 같은 색으로 묶기 위한 팔레트(테두리·링용). 파스텔 계열로
// 골라, 오늘 타는 셔틀에서는 선명하게, 안 타는 날 셔틀에서는 옅게 보여줍니다.
const GROUP_COLORS = [
  "#0ea5e9", "#f97316", "#8b5cf6", "#10b981", "#ec4899",
  "#eab308", "#ef4444", "#14b8a6", "#6366f1", "#a855f7",
  "#f43f5e", "#22c55e", "#3b82f6", "#d946ef", "#f59e0b",
];

// 예전에는 여기서 toISOString().slice(0,10)을 썼습니다 - UTC라서 한국 시간 자정~오전 9시
// 사이에는 **하루 전** 날짜가 나왔습니다. 같은 실수를 네 번 반복한 뒤 kst.ts로 모았습니다.
function todayStr() {
  return todayKst();
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
  toddleBase = null,
  actor,
  initialLog = [],
}: {
  routes: ChecklistRoute[];
  items: ChecklistItem[];
  roster: RosterStudent[];
  initialMessages: GoogleChatMirrorMessage[];
  term: string;
  persistentNotes?: PersistentNote[];
  /** 토들 학교 주소("…/platform/xxx"). 방 id와 합쳐 원문 링크를 만듭니다. */
  toddleBase?: string | null;
  /** 지금 이 화면을 보고 있는 사람. 활동 기록에 이름으로 남습니다. */
  actor: LogActor;
  /** 오늘 이 화면에서 있었던 일. 사이드바의 '오늘 한 일'이 씁니다. */
  initialLog?: ChecklistLogRow[];
}) {
  const notify = useToast();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [activityLog, setActivityLog] = useState<ChecklistLogRow[]>(initialLog);

  /**
   * 기록 한 줄을 남기고 화면에도 즉시 얹습니다.
   *
   * 화면에 바로 보여야 하는 이유: 옆자리에서 같은 표를 보고 있는 사람이 "내가 방금 누른 게
   * 반영됐나"를 확인할 곳이 여기뿐입니다. 새로고침해야 보이면 아무도 안 봅니다.
   */
  async function record(entry: {
    assignmentId: string | null;
    studentName: string;
    action: "상태변경" | "노선이동" | "메모";
    before?: string | null;
    after?: string | null;
  }) {
    const serviceDate = todayStr();
    setActivityLog((prev) =>
      [
        {
          id: `local-${Date.now()}`,
          service_date: serviceDate,
          assignment_id: entry.assignmentId,
          student_name: entry.studentName,
          action: entry.action,
          before_value: entry.before ?? null,
          after_value: entry.after ?? null,
          actor_email: actor.email,
          actor_name: actor.name,
          created_at: new Date().toISOString(),
        } satisfies ChecklistLogRow,
        ...prev,
      ].slice(0, 100),
    );
    await logChecklist(createClient(), { serviceDate, term, ...entry, actor });
  }
  const [notes, setNotes] = useState<PersistentNote[]>(initialNotes);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 자동 분류 근거 창(요청: "느낌표 아이콘 만들고 누르면 채팅 나오고 연결도 되게끔").
  const [sourceOf, setSourceOf] = useState<ChecklistItem | null>(null);

  // 오늘 이 표에서 사람이 손댄 배정. ❓가 붙는 조건이자, 근거 창에 이력을 붙이는 기준입니다.
  //
  // 픽업·결석뿐 아니라 **노선을 옮긴 경우에도** ❓가 있어야 합니다. 차가 바뀌어 있는데
  // 누가 옮겼는지 물어볼 곳이 없으면, 결국 사람이 전화로 확인하게 됩니다.
  const touchedIds = useMemo(
    () => new Set(activityLog.map((r) => r.assignment_id).filter((x): x is string => !!x)),
    [activityLog],
  );

  /** 근거 창에 붙일 "이 학생에게 오늘 있었던 일". 배정이 여러 줄인 아이도 있어 이름으로도 봅니다. */
  const historyOf = (item: ChecklistItem | null) =>
    item
      ? activityLog.filter((r) => r.assignment_id === item.assignmentId || r.student_name === item.studentName)
      : [];

  /** 근거 창 안에 넣는 "누가 언제 무엇을" 목록. 두 창이 같은 모양이어야 헷갈리지 않습니다. */
  function HistoryBlock({ item }: { item: ChecklistItem }) {
    const rows = historyOf(item);
    if (rows.length === 0) return null;
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-bold text-slate-700">🕘 오늘 이 학생에게 있었던 일</p>
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline gap-1.5 text-[11px] leading-snug text-slate-600">
              <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
                {new Date(r.created_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="shrink-0 rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{r.action}</span>
              <span className="min-w-0">
                <b className="text-slate-800">{r.actor_name || r.actor_email}</b>
                {" · "}
                {r.action === "메모"
                  ? r.after_value
                    ? `메모를 "${r.after_value}"로`
                    : "메모를 지움"
                  : `${r.before_value ?? "?"} → ${r.after_value ?? "?"}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const [teaching, setTeaching] = useState(false);

  // "이건 픽업이 아닙니다"를 연락 자체에 남깁니다.
  //
  // 오늘 표시만 지우면 원래 연락은 그대로라 내일 또 올라옵니다. 사람은 같은 것을 매일 지우게
  // 되고, 그러다 지치면 그냥 두게 됩니다. 그래서 **세 가지를 한 번에** 합니다.
  //   ① 그 연락을 '무시'로 → 체크표·대시보드에서 다시 안 올라옵니다
  //   ② 발신자별 정정 기록에 +1 → 같은 발신자의 다음 픽업 판단이 낮아져 사람이 먼저 봅니다
  //   ③ 오늘 표시를 '예정'으로 되돌림
  async function teachNotPickup(item: ChecklistItem) {
    const src = item.autoSource;
    if (!src?.requestId) return;
    setTeaching(true);
    try {
      const res = await fetch("/api/pickup/not-pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: src.requestId, studentName: item.studentName }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        notify("가르치지 못했습니다: " + (j.error ?? ""), "error");
        return;
      }
      await setStatus(item, item.status); // 오늘 표시 되돌리기(같은 값 = 토글 → 예정)
      notify("픽업이 아니라고 알려줬습니다. 다음부터 같은 발신자는 사람이 먼저 확인합니다.", "success");
      setSourceOf(null);
      router.refresh();
    } finally {
      setTeaching(false);
    }
  }
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
    const today = todayStr();
    // 요일도 한국 기준으로 셉니다.
    const todayW = new Date(`${today}T12:00:00+09:00`).getDay();
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
      // 특이사항이 정하는 오늘 상태. 사람이 표에서 이미 손으로 바꿔둔 것은 건드리지
      // 않습니다 - 사람이 마지막에 본 것이 맞습니다.
      let forcedStatus: "픽업" | "결석" | null = null;
      for (const note of notes) {
        if (!matches(note, it)) continue;
        // 기간이 적힌 특이사항은 **오늘이 그 기간 안일 때만** 듣습니다.
        // 9/23~9/28 결석을 9/10에 미리 등록해도 9/10에는 아무 일이 없어야 합니다 -
        // 그게 "미리 넣어둘 수 있다"의 뜻입니다.
        const inPeriod =
          (!note.effectFrom || note.effectFrom <= today) && (!note.effectTo || today <= note.effectTo);

        if (note.effectKind === "no_shuttle") {
          individual = true;
          riding = false;
        } else if (note.effectKind === "skip_days" && note.effectDays.includes(todayW)) {
          riding = false;
        } else if (note.effectKind === "absent" && inPeriod) {
          // 결석은 셔틀만 빼는 게 아니라 그날 상태 자체가 결석입니다.
          riding = false;
          forcedStatus = "결석";
        } else if (note.effectKind === "pickup" && inPeriod) {
          // 픽업도 마찬가지 - 차는 안 타고, 보호자가 데려갑니다.
          // 요일이 적혀 있으면(매주 수요일 픽업) 그 요일에만 겁니다.
          if (note.effectDays.length === 0 || note.effectDays.includes(todayW)) {
            riding = false;
            forcedStatus = "픽업";
          }
        }
      }
      return {
        ...it,
        ridingToday: riding,
        // 사람이 표에서 이미 바꿔둔 줄은 그대로 둡니다 - 사람이 마지막에 본 것이 맞습니다.
        status: it.status === "예정" && forcedStatus ? forcedStatus : it.status,
        individualPickup: individual,
        groupColor: colorByKey.get(key) ?? null,
      };
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
      // 옆자리에서 누른 것도 '오늘 한 일'에 바로 뜨게 합니다. 같은 표를 둘이 보고 있을 때
      // 서로의 손길이 늦게 보이면, 같은 아이를 두 번 고치게 됩니다.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shuttle_checklist_log" }, (payload) => {
        const row = payload.new as ChecklistLogRow | undefined;
        if (!row?.id) return;
        setActivityLog((prev) => {
          // 내가 방금 남긴 줄은 이미 화면에 있습니다(local-…). 같은 것이 두 번 보이지 않게
          // 사람·학생·시각이 겹치는 임시 줄을 진짜 줄로 바꿔 끼웁니다.
          const withoutMine = prev.filter(
            (r) =>
              !(
                r.id.startsWith("local-") &&
                r.student_name === row.student_name &&
                r.actor_email === row.actor_email &&
                r.action === row.action
              ),
          );
          if (withoutMine.some((r) => r.id === row.id)) return withoutMine;
          return [row, ...withoutMine].slice(0, 100);
        });
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
        {
          service_date: todayStr(),
          assignment_id: item.assignmentId,
          status: finalStatus,
          // **누가** 눌렀는지를 줄 자체에 남깁니다. 예전에는 "체크표"만 남아서, 근거 창이
          // "체크표가 체크표에서 픽업으로 표시했습니다"라고 말하고 있었습니다.
          checked_by: actor.name || actor.email,
          checked_at: new Date().toISOString(),
        },
        { onConflict: "service_date,assignment_id" }
      );
    setBusyId(null);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      setItems((prev) => prev.map((it) => (it.assignmentId === item.assignmentId ? { ...it, status: item.status } : it)));
      return;
    }
    void record({
      assignmentId: item.assignmentId,
      studentName: item.studentName,
      action: "상태변경",
      before: item.status,
      after: finalStatus,
    });
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
        .upsert(
          { service_date: todayStr(), assignment_id: assignmentId, override_route_id: nextOverride, checked_by: actor.name || actor.email },
          { onConflict: "service_date,assignment_id" },
        );
      if (error) {
        notify("노선 이동을 저장하지 못했습니다: " + error.message, "error");
        setItems((prev) => prev.map((it) => (it.assignmentId === assignmentId ? { ...it, overrideRouteId: prevOverride } : it)));
      } else {
        notify(
          nextOverride ? `${item.studentName} 학생을 오늘만 다른 차량으로 옮겼습니다.` : `${item.studentName} 학생을 원래 노선으로 되돌렸습니다.`,
          "success"
        );
        void record({
          assignmentId,
          studentName: item.studentName,
          action: "노선이동",
          before: `${routeById.get(prevOverride ?? baseline)?.route_no ?? "?"}호`,
          after: `${routeById.get(nextOverride ?? baseline)?.route_no ?? "?"}호 (오늘만)`,
        });
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
        void record({
          assignmentId,
          studentName: item.studentName,
          action: "노선이동",
          before: `${routeById.get(prevPermanent ?? item.homeRouteId)?.route_no ?? "?"}호`,
          after: `${routeById.get(nextPermanent ?? item.homeRouteId)?.route_no ?? "?"}호 (계속)`,
        });
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
    void record({
      assignmentId,
      studentName: noteEditor.studentName,
      action: "메모",
      before: prev,
      after: trimmed || null,
    });
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
  // 동명이인만 이름 옆에 학년·반을 붙입니다(담당자 요청).
  //
  // 한 명뿐인 이름에까지 붙이면 표가 글자로 가득 차고, 정작 구분이 필요한 이름이 묻힙니다.
  // 판단은 @/lib/studentLabel 한 곳에서만 합니다 - 화면마다 따로 두면 같은 아이가 화면마다
  // 다르게 불립니다.
  const homonyms = useMemo(() => buildHomonymSet(roster), [roster]);
  const whereByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of roster) {
      const k = normStudentName(s.name);
      if (!homonyms.has(k)) continue;
      const w = whereLabel({ name: s.name, grade: s.grade, className: s.className });
      if (w) m.set(k, w);
    }
    return m;
  }, [roster, homonyms]);

  // 영어 이름으로도 찾기 (담당자: "아이들 영어이름으로도 검색할 수 있게 해줘").
  //
  // 배정표(shuttle_assignments)에는 **한글 이름만** 들어 있습니다. 영어 이름은 학생 명부
  // 쪽에만 있어서, 명부와 이어붙여야 검색이 됩니다. 그 이어붙이기를 여기서 한 번만 하고
  // 표에는 결과(배정 → 영어 이름)만 넘깁니다 - 표가 명부까지 들고 다닐 이유가 없습니다.
  //
  // 배정표 이름에는 "김재이(G2A)"처럼 구분 표기가 붙은 것이 섞여 있어, 괄호 안을 떼고
  // 맞춰봅니다. 그래도 못 찾으면 그냥 비워둡니다 - 억지로 비슷한 사람을 붙이면 엉뚱한
  // 아이가 검색에 걸립니다.
  const enByAssignment = useMemo(() => {
    const enByKorean = new Map<string, string>();
    for (const s of roster) {
      const en = (s.nameEn ?? "").trim();
      if (en) enByKorean.set(normStudentName(s.name), en);
    }
    const m = new Map<string, string>();
    for (const it of items) {
      const raw = normStudentName(it.studentName);
      const bare = normStudentName(it.studentName.replace(/[（(].*?[）)]/g, ""));
      const en = enByKorean.get(raw) ?? enByKorean.get(bare);
      if (en) m.set(it.assignmentId, en);
    }
    return m;
  }, [items, roster]);

  const [searchTerm, setSearchTerm] = useState("");

  // 화면 빈 곳을 누르면 찾기(하이라이트)를 풉니다 - 담당자 요청.
  //
  // 누르는 대상이 버튼·입력칸·링크·표의 줄이면 그건 "일하려고 누른 것"이므로 놔둡니다.
  // 그 외(배경·여백)를 누르면 해제합니다. Esc로도 풀립니다 - 손이 키보드에 있을 때 더 빠릅니다.
  useEffect(() => {
    if (!searchTerm) return;
    function onDocClick(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, a, input, select, textarea, label, tr, [data-keep-search]")) return;
      setSearchTerm("");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSearchTerm("");
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchTerm]);

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
            .select("id, student_name, student_id, route_no, content, effect_kind, effect_days, effect_from, effect_to")
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
              effectFrom: (n.effect_from as string | null) ?? null,
              effectTo: (n.effect_to as string | null) ?? null,
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
    /** 여러 명을 한 번에 받습니다. 형제나 같이 여행 가는 아이들을 한 명씩 넣는 것은 일입니다. */
    studentNames: string[];
    routeNo: string | null;
    content: string;
    effectKind: PersistentNote["effectKind"];
    effectDays: number[];
    effectFrom: string | null;
    effectTo: string | null;
  }) {
    const names = input.studentNames.map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) {
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
    // 결석·픽업은 **언제부터인지**가 없으면 아무 뜻이 없습니다. 오늘부터인지 다음 주부터인지
    // 모르면 셔틀을 언제 빼야 할지 정할 수가 없습니다.
    if ((input.effectKind === "absent" || input.effectKind === "pickup") && !input.effectFrom) {
      notify("날짜를 골라주세요. 하루만이면 시작일만 넣으면 됩니다.", "error");
      return false;
    }
    if (input.effectFrom && input.effectTo && input.effectTo < input.effectFrom) {
      notify("끝나는 날이 시작일보다 앞섭니다.", "error");
      return false;
    }
    setNoteBusyPersist(true);
    const supabase = createClient();
    const rows = names.map((studentName) => {
      const matched = items.find((it) => normName(it.studentName) === normName(studentName));
      return {
        term,
        student_name: studentName,
        student_id: matched?.studentId ?? null,
        route_no: input.routeNo?.trim() || null,
        content: input.content.trim().slice(0, 300),
        effect_kind: input.effectKind,
        effect_days: input.effectKind === "skip_days" ? input.effectDays : [],
        effect_from: input.effectFrom,
        // 하루짜리면 끝나는 날을 시작일과 같게 둡니다. 비워두면 "끝이 없는 결석"이 됩니다.
        effect_to: input.effectTo ?? input.effectFrom,
        created_by: "체크표",
      };
    });
    const { data, error } = await supabase
      .from("shuttle_persistent_notes")
      .insert(rows)
      .select("id, student_name, student_id, route_no, content, effect_kind, effect_days, effect_from, effect_to");
    setNoteBusyPersist(false);
    if (error || !data) {
      notify("특이사항을 저장하지 못했습니다: " + (error?.message ?? "알 수 없는 오류"), "error");
      return false;
    }
    setNotes((prev) => [
      ...(data as Record<string, unknown>[]).map((d) => ({
        id: d.id as string,
        studentName: d.student_name as string,
        studentId: (d.student_id as string | null) ?? null,
        routeNo: (d.route_no as string | null) ?? null,
        content: d.content as string,
        effectKind: (d.effect_kind as PersistentNote["effectKind"]) ?? "none",
        effectFrom: (d.effect_from as string | null) ?? null,
        effectTo: (d.effect_to as string | null) ?? null,
        effectDays: (d.effect_days as number[] | null) ?? [],
      })),
      ...prev,
    ]);
    // 못 찾은 이름을 조용히 넘기지 않습니다. 이름이 명부와 다르면 그 줄은 아무 아이에게도
    // 안 붙는데, 화면은 "추가했습니다"만 말하고 끝나기 쉽습니다.
    const unmatched = names.filter((n) => !items.some((it) => normName(it.studentName) === normName(n)));
    notify(
      unmatched.length > 0
        ? `${names.length}명 추가했습니다. 다만 ${unmatched.join("·")}은(는) 오늘 명단에서 못 찾았습니다 - 이름을 확인해주세요.`
        : `${names.length}명에게 지속 특이사항을 추가했습니다.`,
      unmatched.length > 0 ? "error" : "success"
    );
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

  // 사이드바 세 번째 위젯("오늘 차량 변경")용.
  //
  // **오늘 하루만 바뀐 아이만 담습니다.**
  //
  // 예전에는 "계속 유지"로 옮긴 아이까지 함께 넣고 [계속] 딱지를 붙였습니다. 그런데 계속
  // 옮겨진 아이에게는 그게 **평소 상태**입니다. 송우진·송윤진은 28호에서 27호로 옮긴 뒤로
  // 쭉 27호를 타는데, 매일 아침 "오늘 차량 변경"에 이름이 떠 있었습니다. 매일 뜨는 알림은
  // 며칠이면 배경이 되고, 그 옆에 정말 오늘만 바뀐 아이가 끼어도 눈에 안 들어옵니다.
  //
  // 이 위젯이 답해야 하는 물음은 "오늘 평소와 다른 아이가 누구인가" 하나입니다.
  const changedToday: ChangedRouteEntry[] = useMemo(() => {
    return items
      .filter((it) => {
        // 오늘치 이동(overrideRouteId)이 있고, 그것이 '평소 노선'과 다를 때만.
        // 평소 노선 = 계속 옮겨둔 곳이 있으면 그곳, 없으면 원래 배정된 곳.
        const usual = it.permanentRouteId ?? it.homeRouteId;
        return !!it.overrideRouteId && it.overrideRouteId !== usual;
      })
      .map((it) => ({
        key: it.assignmentId,
        studentName: it.studentName,
        // 어디서 옮겨왔는지도 **평소 노선** 기준입니다. 원래 배정된 곳을 적으면
        // "27호→27호"처럼 말이 안 되는 줄이 나옵니다.
        fromRouteNo: routeById.get(it.permanentRouteId ?? it.homeRouteId)?.route_no ?? "?",
        toRouteNo: routeById.get(effectiveRouteId(it))?.route_no ?? "?",
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [items, routeById]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <ShuttleChecklistSidebar
        roster={roster}
        activityLog={activityLog}
        initialMessages={initialMessages}
        changedToday={changedToday}
        specialNotes={specialNotes}
        className="print:hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
        onSelectStudentName={setSearchTerm}
        onAddPersistentNote={addPersistentNote}
        persistNoteBusy={noteBusyPersist}
        // 위젯에서 ✕로 내리면 그 아이의 셔틀 표시도 '예정'으로 돌아갑니다. 실시간 구독이
        // 잡아주긴 하지만, 배정이 여러 줄인 경우를 놓치지 않도록 서버에서 한 번 다시 읽습니다.
        onStatusReverted={() => router.refresh()}
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
                      : n.effectKind === "absent"
                        ? "결석(셔틀 제외)"
                        : n.effectKind === "pickup"
                          ? "픽업(보호자)"
                          : "메모";
                // 날짜와 "지금 듣고 있는지"를 함께 보여줍니다.
                //
                // 앞날 결석을 미리 넣어두면 오늘은 아무 일도 안 일어나는 것이 맞습니다. 그런데
                // 화면이 그냥 목록에 섞어 보여주면, 넣은 사람은 "지금 셔틀에서 빠졌나?" 하고
                // 헷갈립니다. 그래서 **오늘 적용중**인지 **9/23부터**인지를 못 박아 적습니다.
                const today = todayStr();
                const period =
                  n.effectFrom || n.effectTo
                    ? n.effectFrom && n.effectTo && n.effectFrom !== n.effectTo
                      ? `${n.effectFrom.slice(5)}~${n.effectTo.slice(5)}`
                      : (n.effectFrom ?? n.effectTo)!.slice(5)
                    : null;
                const upcoming = !!n.effectFrom && n.effectFrom > today;
                const past = !!n.effectTo && n.effectTo < today;
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
                    {period && (
                      <span
                        className={
                          "rounded-full px-1.5 py-0.5 text-[9px] font-bold " +
                          (upcoming
                            ? "bg-slate-200 text-slate-600"
                            : past
                              ? "bg-slate-100 text-slate-400"
                              : "bg-red-100 text-red-700")
                        }
                        title={upcoming ? "아직 시작 전입니다" : past ? "이미 지났습니다" : "오늘 적용 중입니다"}
                      >
                        {period}
                        {upcoming ? " 예정" : past ? " 지남" : " 적용중"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setNoteMenuId((cur) => (cur === n.id ? null : n.id))}
                      title="지우기(원래 셔틀로 복귀)"
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 print:hidden"
                    >
                      ⋯
                    </button>
                    {noteMenuId === n.id && (
                      <span className="absolute right-0 top-full z-10 mt-1 flex flex-col g-panel-solid p-1 shadow-lg print:hidden">
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
        {/* 이 줄은 인쇄에서 뺍니다.
            같은 내용(날짜 · 탑승 인원)이 인쇄본 맨 윗줄에 이미 있는데, 여기까지 종이에 나가면
            44px을 잡아먹어 표가 두 번째 장으로 밀립니다. 실측해보니 그 44px과 화면 여백 48px,
            합쳐서 92px이 정확히 두 번째 장의 정체였습니다. */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 g-panel-solid px-3 py-2 text-xs font-semibold text-slate-600 print:hidden">
          <span>
            📅 {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })} · 🧒 탑승예정{" "}
            <span className="text-sm font-bold text-slate-800">{expectedCount}</span>명
          </span>
          <div className="flex items-center gap-1.5 print:hidden">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 이름 검색 (한글·영어)"
              className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-400 sm:w-48"
            />
            {/* 담당자: "백서아를 누르니까 찾아서 색이 바뀌었는데 해제할 수 없어."
                왼쪽 위젯에서 이름을 누르면 이 검색어가 채워지는데, 그 뒤로 지우는 방법이
                검색창을 직접 비우는 것뿐이었습니다. 위젯을 눌러서 켰으면 끄는 것도 그만큼
                쉬워야 합니다. 화면 아무 곳이나 눌러도 풀리고(아래 onClick), 이 ✕로도 풉니다. */}
            {/* 영어로 쳤는데 **명부에 영어 이름이 하나도 없으면** 아무 일도 안 일어납니다.
                그러면 "이 아이가 없나"로 읽히지만 실제로는 "자료가 없다"입니다. 둘은
                전혀 다른 이야기라, 화면이 어느 쪽인지 말해줘야 합니다. */}
            {/[a-zA-Z]/.test(searchTerm) && enByAssignment.size === 0 && (
              <span className="text-[10px] font-medium text-orange-600" data-keep-search>
                명부에 영어 이름이 없어 영어 검색이 안 됩니다
              </span>
            )}
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                title="찾기 해제"
              >
                ✕ 해제
              </button>
            )}
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
            enByAssignment={enByAssignment}
            onSetStatus={setStatus}
            onRequestMove={requestMove}
            onRequestEditNote={openNoteEditor}
            whereByName={whereByName}
            onShowSource={setSourceOf}
            touchedIds={touchedIds}
          />
        </div>
        <ChecklistPrintSheet
          routes={routes}
          items={displayItems}
          whereByName={whereByName}
          // 담당자: "몇 년 몇 월 몇 일 몇 요일인지" - 종이는 며칠 뒤에도 굴러다닙니다.
          // 연도까지 없으면 언제 것인지 알 수 없습니다.
          dateLabel={new Date().toLocaleDateString("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        />
      </div>

      {/* 자동 분류 근거 창.
          담당자: "느낌표 아이콘 만들고 누르면 채팅 나오고 연결도 되게끔 만들어줘 -
                   자동으로 분류되는 거 이유가 뭔지 보고 싶어."
          기계가 붙인 표시 옆에 그 근거가 없으면, 맞는지 확인하려고 매번 인박스로 넘어가
          그 아이를 다시 찾아야 합니다. */}
      {sourceOf && !sourceOf.autoSource && (
        // 사선은 그어져 있는데 근거를 못 찾은 경우.
        //
        // 담당자: "이유가 없이 사선 표시 되어 있어. 사선 표시는 무조건 사유가 있게 해주고,
        //          내가 눌러서 체크한 거라면 이용자가 체크했다고 알려줘."
        //
        // 근거가 없다는 사실 자체를 숨기지 않습니다. 빈 창을 띄우거나 버튼을 감추면 사람은
        // "왜 안 되지?" 하고 시간을 더 씁니다. 모르면 모른다고 적고, 지금 할 수 있는 일을
        // 함께 놓아둡니다.
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4 print:hidden" onClick={() => setSourceOf(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 text-sm font-bold text-slate-800">
              {sourceOf.studentName} · {sourceOf.status}
            </p>
            {historyOf(sourceOf).length > 0 ? (
              <p className="mb-1 rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
                오늘 이 표에서 <b>사람이 직접 바꾼</b> 것입니다. 아래에 누가 언제 무엇을 했는지 적혀 있습니다.
              </p>
            ) : (
              <p className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-[12px] leading-relaxed text-orange-800">
                이 표시가 <b>왜 붙었는지 찾지 못했습니다.</b>
                <br />
                오늘 들어온 연락에도, 체크표 기록에도 근거가 없습니다. 어제 눌러둔 것이 남아 있거나,
                연락이 지워졌을 수 있습니다.
              </p>
            )}
            <HistoryBlock item={sourceOf} />
            <div className="mb-3" />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void setStatus(sourceOf, sourceOf.status);
                  setSourceOf(null);
                }}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-700"
              >
                ✕ 표시 지우기
              </button>
              <button
                type="button"
                onClick={() => setSourceOf(null)}
                className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {sourceOf?.autoSource && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4 print:hidden" onClick={() => setSourceOf(null)}>
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold text-slate-800">{sourceOf.studentName}</span>
              <span
                className={
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                  (sourceOf.autoSource.kind === "픽업" ? "bg-pink-100 text-pink-700" : "bg-red-100 text-red-600")
                }
              >
                {sourceOf.autoSource.kind}
              </span>
              <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                {sourceOf.autoSource.source}에서 자동
              </span>
            </div>

            <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
              {sourceOf.autoSource.channelLabel && (
                <>
                  <dt className="font-semibold">채널</dt>
                  <dd className="min-w-0 break-words">{sourceOf.autoSource.channelLabel}</dd>
                </>
              )}
              {sourceOf.autoSource.senderName && (
                <>
                  <dt className="font-semibold">보낸 분</dt>
                  <dd className="min-w-0 break-words">{sourceOf.autoSource.senderName}</dd>
                </>
              )}
              {sourceOf.autoSource.receivedAt && (
                <>
                  <dt className="font-semibold">받은 때</dt>
                  <dd>
                    {new Date(sourceOf.autoSource.receivedAt).toLocaleString("ko-KR")}
                    {/* 받은 날과 오늘이 다르면 짚어줍니다.
                        담당자: "김리안의 경우 어제 픽업인데 오늘까지 반영되어 있어."
                        어제 온 연락이 오늘 대상으로 잡혀 있으면 그게 바로 원인입니다. */}
                    {sourceOf.autoSource.receivedAt.slice(0, 10) !== todayStr() && (
                      <span className="ml-1 font-bold text-amber-600">← 오늘 온 연락이 아닙니다</span>
                    )}
                  </dd>
                </>
              )}
              <dt className="font-semibold">연결된 이름</dt>
              <dd className="min-w-0 break-words">
                {sourceOf.autoSource.matchedName ?? <span className="text-amber-600">명부와 대조되지 않음(이름만 비교)</span>}
              </dd>
            </dl>

            <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
              {sourceOf.autoSource.rawText || "(원문이 저장되지 않았습니다)"}
            </p>

            {sourceOf.autoSource.aiNote && (
              <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
                <span className="font-bold">판단 근거</span> · {sourceOf.autoSource.aiNote}
              </p>
            )}

            {/* 자동으로 붙은 뒤에 사람이 손댔을 수 있습니다. 그 순서가 보여야 지금 화면이
                왜 이 모양인지 설명이 됩니다. */}
            <HistoryBlock item={sourceOf} />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(() => {
                const s = sourceOf.autoSource!;
                const url = s.sourceUrl ?? (toddleBase && s.sourceChatId ? `${toddleBase}/messaging/${s.sourceChatId}` : null);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-500"
                  >
                    토들에서 보기 ↗
                  </a>
                ) : null;
              })()}
              <a
                href="/pickup/inbox"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                픽업 인박스 ↗
              </a>
              {/* 근거를 보고 "아니네" 싶으면 그 자리에서 되돌립니다. 확인과 조치가 갈라져
                  있으면 확인만 하고 넘어가게 됩니다. */}
              <button
                type="button"
                onClick={() => {
                  void setStatus(sourceOf, sourceOf.status);
                  setSourceOf(null);
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                ✕ 표시만 지우기
              </button>
              {/* 이게 이번 요청의 핵심입니다.
                  담당자: "판단 근거를 수정해서 학습시키고 싶은데, 물음표로 근거 창이 나올 때
                           학습시킬 수 있도록 해줘."
                  "표시만 지우기"는 오늘 하루만 고칩니다. 원래 연락은 그대로 남아 있어서 내일
                  또 같은 판단이 나옵니다. 여기서는 **연락 자체를 '픽업 아님'으로 되돌려**
                  다시 안 올라오게 하고, 그 정정을 발신자별 기록에 남겨 다음 판단을 낮춥니다. */}
              {sourceOf.autoSource.requestId && (
                <button
                  type="button"
                  disabled={teaching}
                  onClick={() => void teachNotPickup(sourceOf)}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600 disabled:opacity-40"
                  title="이 연락은 픽업이 아니라고 알려줍니다. 오늘 표시도 함께 지워지고, 다음부터 같은 발신자의 비슷한 연락은 사람이 먼저 확인하게 됩니다."
                >
                  {teaching ? "…" : "🎓 픽업 아님으로 가르치기"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSourceOf(null)}
                className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-700"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

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
