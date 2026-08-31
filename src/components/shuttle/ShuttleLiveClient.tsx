"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { useToast } from "@/components/common/ToastProvider";
import type { ShuttlePilotPing, ShuttlePilotRoute, ShuttleRoute, ShuttleRunEvent } from "@/lib/types";

// 예전에는 7초마다 세 테이블(위치·운행이벤트·탑승현황)을 통째로 다시 불러왔는데, 이 세
// 테이블이 모두 Supabase Realtime 발행 목록에 있어서(shuttle_pilot_pings·shuttle_run_events는
// 기존부터, shuttle_boardings는 하원 체크표 실시간화 때 추가) 대신 실시간 이벤트를 직접
// 구독해 훨씬 빠르게(초 단위가 아니라 사실상 즉시) 반영하도록 바꿨습니다(요청: "실시간 반영
// 속도 더 개선"). 재연결 등으로 이벤트를 놓쳤을 때를 대비한 안전망 폴링만 느슨하게 남겨둡니다.
const FALLBACK_POLL_MS = 25000;

export type LiveRosterItem = { assignmentId: string; studentName: string; stopSeq: number; stopTime: string | null; routeId: string };
type BoardingRow = { assignment_id: string; status: string; alighted_at: string | null; override_route_id: string | null };

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// 교직원 전체(교사 포함)가 보는 실시간 셔틀 화면 - 관리자 전용 PilotMonitorClient(링크 관리)와는
// 분리된, 조회 + '현장도착' 체크 전용 화면입니다(요청 3번 답변: "차량도착은 교직원이 모바일로
// 체크, 체크된 차량은 안내보드에서... 탑승과동시에 동승선생님이 체크하면 바로 탑승완료 교직원이
// 모바일로 확인 가능"). 탑승 체크 자체는 여전히 동승선생님이 기존 체크인 링크(토큰)에서 하고,
// 이 화면은 그 결과를 실시간으로 보여주기만 합니다(REST 폴링 - 다른 기능의 Realtime 자원과
// 완전히 격리된 기존 파일럿 아키텍처를 그대로 재사용).
export default function ShuttleLiveClient({
  routes,
  pilots,
  allRoster,
  userLabel,
}: {
  routes: ShuttleRoute[];
  pilots: ShuttlePilotRoute[];
  allRoster: LiveRosterItem[];
  userLabel: string;
}) {
  const notify = useToast();
  const [pingByRoute, setPingByRoute] = useState<Record<string, ShuttlePilotPing | null>>({});
  const [eventsByRoute, setEventsByRoute] = useState<Record<string, ShuttleRunEvent[]>>({});
  const [boardingByAssignment, setBoardingByAssignment] = useState<Record<string, BoardingRow>>({});
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyRoute, setBusyRoute] = useState<string | null>(null);

  const pilotByRoute = useMemo(() => new Map(pilots.filter((p) => p.enabled).map((p) => [p.route_id, p])), [pilots]);

  // 하원 체크표에서 오늘 하루만 다른 노선으로 옮긴 학생은(요청: "표안에서 아이들의 이름을
  // 자유롭게 끌어서 이동할 수 있게") 원래 노선이 아니라 옮겨진 노선의 카드에 나타나야 하므로,
  // 폴링으로 받아온 override_route_id를 기준으로 매번 다시 묶습니다.
  const routeIdSet = useMemo(() => new Set(routes.map((r) => r.id)), [routes]);
  const rosterByRoute = useMemo(() => {
    const map: Record<string, LiveRosterItem[]> = {};
    for (const item of allRoster) {
      const override = boardingByAssignment[item.assignmentId]?.override_route_id;
      const targetRouteId = override && routeIdSet.has(override) ? override : item.routeId;
      (map[targetRouteId] ??= []).push(item);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));
    }
    return map;
  }, [allRoster, boardingByAssignment, routeIdSet]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const pilotRouteIds = pilots.filter((p) => p.enabled).map((p) => p.route_id);
    const assignmentIds = allRoster.map((r) => r.assignmentId);
    if (pilotRouteIds.length === 0) return;
    const supabase = createClient();
    const today = todayStr();
    const pilotRouteIdSet = new Set(pilotRouteIds);
    const assignmentIdSet = new Set(assignmentIds);

    async function fullReload() {
      const [pingsRes, eventsRes, boardingsRes] = await Promise.all([
        supabase.from("shuttle_pilot_pings").select("*").in("route_id", pilotRouteIds).order("recorded_at", { ascending: false }).limit(500),
        supabase.from("shuttle_run_events").select("*").in("route_id", pilotRouteIds).eq("service_date", today).order("created_at", { ascending: true }),
        assignmentIds.length > 0
          ? supabase
              .from("shuttle_boardings")
              .select("assignment_id, status, alighted_at, override_route_id")
              .eq("service_date", today)
              .in("assignment_id", assignmentIds)
          : Promise.resolve({ data: [] as BoardingRow[] }),
      ]);

      const latestByRoute: Record<string, ShuttlePilotPing> = {};
      for (const p of (pingsRes.data as ShuttlePilotPing[] | null) ?? []) {
        if (!latestByRoute[p.route_id]) latestByRoute[p.route_id] = p;
      }
      setPingByRoute(latestByRoute);

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

    fullReload();

    // 세 테이블 모두 realtime 발행 목록에 있어서, 새 위치·도착체크·탑승체크가 들어오는 즉시
    // 서버 왕복 없이 화면에 반영합니다(요청: "실시간 반영 속도 더 개선"). 위치(ping)는 GPS가
    // 자주 보내는 값이라 전체를 다시 훑지 않고 그 노선의 "최신 값"만 교체합니다.
    const channel = supabase
      .channel("shuttle-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shuttle_pilot_pings", filter: `route_id=in.(${pilotRouteIds.join(",")})` }, (payload) => {
        const p = payload.new as ShuttlePilotPing;
        if (!pilotRouteIdSet.has(p.route_id)) return;
        setPingByRoute((prev) => ({ ...prev, [p.route_id]: p }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_run_events", filter: `route_id=in.(${pilotRouteIds.join(",")})` }, (payload) => {
        const isDelete = payload.eventType === "DELETE";
        const row = (isDelete ? payload.old : payload.new) as ShuttleRunEvent | undefined;
        if (!row?.route_id || !pilotRouteIdSet.has(row.route_id) || row.service_date !== today) return;
        setEventsByRoute((prev) => {
          const existing = prev[row.route_id] ?? [];
          if (isDelete) return { ...prev, [row.route_id]: existing.filter((e) => e.id !== row.id) };
          // checkArrived가 누른 즉시 "temp-" 임시 id로 먼저 화면에 넣어두는데(요청: 여러 대가
          // 몰려도 버벅이지 않도록), 그 직후 도착하는 realtime 이벤트가 진짜 id를 가져오면
          // 임시 항목을 진짜 값으로 바꿔치기해서 같은 이벤트가 두 번 보이지 않게 합니다.
          const withoutTemp = existing.filter((e) => !(e.event === row.event && e.id.startsWith("temp-")));
          if (withoutTemp.some((e) => e.id === row.id)) return prev;
          return { ...prev, [row.route_id]: [...withoutTemp, row].sort((a, b) => a.created_at.localeCompare(b.created_at)) };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_boardings", filter: `service_date=eq.${today}` }, (payload) => {
        const isDelete = payload.eventType === "DELETE";
        const row = (isDelete ? payload.old : payload.new) as BoardingRow | undefined;
        if (!row?.assignment_id || !assignmentIdSet.has(row.assignment_id)) return;
        setBoardingByAssignment((prev) => {
          if (isDelete) {
            const next = { ...prev };
            delete next[row.assignment_id];
            return next;
          }
          return { ...prev, [row.assignment_id]: row };
        });
      })
      .subscribe();

    const t = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") void fullReload(); }, FALLBACK_POLL_MS);
    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilots, allRoster]);

  async function checkArrived(routeId: string) {
    setBusyRoute(routeId);
    const supabase = createClient();
    const { error } = await supabase
      .from("shuttle_run_events")
      .insert({ service_date: todayStr(), route_id: routeId, event: "현장도착", created_by: userLabel });
    setBusyRoute(null);
    if (error) {
      // 여러 차가 동시에 도착해서 여러 교직원이 거의 동시에 "현장도착"을 누를 수 있습니다
      // (요청: "여러차가 동시에 도착해서 도착버튼이 여러개 눌릴 수도 있으니까"). DB에 부분
      // 유니크 인덱스(shuttle_run_events_arrival_unique_idx)를 걸어둬서, 같은 노선·같은 날
      // 두 번째 이후 체크는 Postgres 유니크 제약 위반(23505)으로 거절됩니다. 이건 실패가
      // 아니라 "이미 다른 분이 체크했다"는 정상 상황이므로 에러 토스트 없이 조용히 넘어가고,
      // 다음 폴링에서 실제 상태(이미 체크됨)를 그대로 화면에 반영합니다.
      if (error.code === "23505") return;
      notify("현장도착 체크에 실패했습니다: " + error.message, "error");
      return;
    }
    setEventsByRoute((prev) => ({
      ...prev,
      [routeId]: [...(prev[routeId] ?? []), { id: "temp-" + Date.now(), service_date: todayStr(), route_id: routeId, event: "현장도착", created_by: userLabel, created_at: new Date().toISOString() }],
    }));
  }

  async function cancelArrived(routeId: string, eventId: string) {
    setBusyRoute(routeId);
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_run_events").delete().eq("id", eventId);
    setBusyRoute(null);
    if (error) {
      notify("취소하지 못했습니다: " + error.message, "error");
      return;
    }
    setEventsByRoute((prev) => ({ ...prev, [routeId]: (prev[routeId] ?? []).filter((e) => e.id !== eventId) }));
  }

  // 요청: "등원은 패스하고 하원만 진행되도록 우선 만들어줘" - routes prop 자체가 이미 하원
  // 노선만 담겨오므로(page.tsx에서 필터링), 여기서는 정렬만 합니다. 등원/방향 탭은 없앴습니다.
  const routesInDirection = useMemo(() => [...routes].sort((a, b) => natCompare(a.route_no, b.route_no)), [routes]);

  // 요청: "여러차가 동시에 도착해서 도착버튼이 여러개 눌릴 수도 있으니까, 어떻게 해야 수월하게
  // 체크가 될지 제안해주고" - 아직 도착하지 않은(체크 안 된) 노선만 큰 버튼으로 따로 모아
  // "미도착 · 빠른 체크" 섹션에 둡니다. 위치·탑승현황 같은 상세 정보 없이 노선 번호와 버튼만
  // 크게 보여줘서, 픽업 서클처럼 여러 차가 몰리는 순간에도 한눈에 훑고 바로 누를 수 있게
  // 했습니다. 누른 뒤에는 그 카드가 자동으로 아래 "상세 현황"으로 넘어갑니다. 중복 탭은 DB의
  // 부분 유니크 인덱스 + 클라이언트의 23505 무시 처리로 안전합니다(checkArrived 참고).
  const quickCheckRoutes = routesInDirection.filter((route) => {
    const pilot = pilotByRoute.get(route.id);
    const events = pilot ? eventsByRoute[route.id] ?? [] : [];
    const arrivedEvent = events.find((e) => e.event === "현장도착");
    const endEvent = [...events].reverse().find((e) => e.event === "도착");
    return !!pilot && !arrivedEvent && !endEvent;
  });
  const detailRoutes = routesInDirection.filter((route) => !quickCheckRoutes.includes(route));

  return (
    <div className="flex flex-col gap-5">
      {routesInDirection.length === 0 && <p className="py-8 text-center text-sm text-slate-400">하원 노선이 없습니다.</p>}

      {quickCheckRoutes.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold text-amber-600">🟡 미도착 · 빠른 체크 (차량이 보이면 바로 눌러주세요)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {quickCheckRoutes.map((route) => (
              <button
                key={route.id}
                onClick={() => checkArrived(route.id)}
                disabled={busyRoute === route.id}
                className="rounded-xl border-2 border-blue-200 bg-blue-50 px-2 py-4 text-center font-black text-blue-700 active:scale-95 disabled:opacity-40"
              >
                <div className="text-2xl">{route.route_no}호</div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-blue-500">{route.name ?? ""}</div>
                <div className="mt-1 text-[11px] font-bold text-blue-600">🚌 도착 체크</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {detailRoutes.length > 0 && (
        <div>
          {quickCheckRoutes.length > 0 && <p className="mb-2 text-xs font-bold text-slate-500">상세 현황</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {detailRoutes.map((route) => {
              const pilot = pilotByRoute.get(route.id);
              const ping = pilot ? pingByRoute[route.id] : null;
              const events = pilot ? eventsByRoute[route.id] ?? [] : [];
              const roster = rosterByRoute[route.id] ?? [];
              return (
                <LiveRouteCard
                  key={route.id}
                  route={route}
                  hasPilot={!!pilot}
                  ping={ping ?? null}
                  events={events}
                  roster={roster}
                  boardingByAssignment={boardingByAssignment}
                  now={now}
                  expanded={!!expanded[route.id]}
                  onToggleExpand={() => setExpanded((prev) => ({ ...prev, [route.id]: !prev[route.id] }))}
                  busy={busyRoute === route.id}
                  onCheckArrived={() => checkArrived(route.id)}
                  onCancelArrived={(eventId) => cancelArrived(route.id, eventId)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LiveRouteCard({
  route,
  hasPilot,
  ping,
  events,
  roster,
  boardingByAssignment,
  now,
  expanded,
  onToggleExpand,
  busy,
  onCheckArrived,
  onCancelArrived,
}: {
  route: ShuttleRoute;
  hasPilot: boolean;
  ping: ShuttlePilotPing | null;
  events: ShuttleRunEvent[];
  roster: LiveRosterItem[];
  boardingByAssignment: Record<string, BoardingRow>;
  now: number;
  expanded: boolean;
  onToggleExpand: () => void;
  busy: boolean;
  onCheckArrived: () => void;
  onCancelArrived: (eventId: string) => void;
}) {
  const startEvent = events.find((e) => e.event === "출발");
  const endEvent = [...events].reverse().find((e) => e.event === "도착");
  const arrivedEvent = events.find((e) => e.event === "현장도착");
  const running = !!startEvent && !endEvent;
  const completed = !!startEvent && !!endEvent;

  const freshnessSec = ping ? Math.max(0, Math.round((now - new Date(ping.recorded_at).getTime()) / 1000)) : null;
  const fresh = freshnessSec != null && freshnessSec < 20;

  const counts = { 탑승: 0, 결석: 0, 미탑승: 0, 픽업: 0, 예정: 0 };
  for (const r of roster) {
    const status = (boardingByAssignment[r.assignmentId]?.status as keyof typeof counts | undefined) ?? "예정";
    counts[status] = (counts[status] ?? 0) + 1;
  }

  let statusLabel = "대기중";
  let statusColor = "#94a3b8";
  if (completed) {
    statusLabel = "운행 종료";
    statusColor = "#059669";
  } else if (running) {
    statusLabel = fresh ? "운행중" : "운행중 · 수신 지연";
    statusColor = "#1d4ed8";
  } else if (arrivedEvent) {
    statusLabel = "현장도착함 · 탑승 대기";
    statusColor = "#d97706";
  }

  return (
    <div className="overflow-hidden g-panel-solid">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-800">
            {route.route_no}호 {route.name ?? ""}
          </p>
          <p className="text-xs font-semibold" style={{ color: statusColor }}>
            {running ? "🔵 " : completed ? "✅ " : arrivedEvent ? "🟠 " : ""}
            {statusLabel}
          </p>
        </div>
        {route.direction === "하원" && hasPilot && !completed && (
          <div>
            {arrivedEvent ? (
              <button
                onClick={() => onCancelArrived(arrivedEvent.id)}
                disabled={busy}
                className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-40"
              >
                ✅ 현장도착 체크됨 · 취소
              </button>
            ) : (
              <button
                onClick={onCheckArrived}
                disabled={busy}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
              >
                🚌 현장도착 체크
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-[140px_1fr]">
        {hasPilot ? (
          <LiveMiniMap lat={ping?.lat} lng={ping?.lng} />
        ) : (
          <div className="flex h-[120px] items-center justify-center rounded-lg bg-slate-50 text-center text-[11px] text-slate-400">
            위치 링크 없음
          </div>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-slate-400">
            {freshnessSec == null ? "아직 수신된 위치가 없습니다" : `마지막 위치 ${freshnessSec}초 전`}
          </p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <CountChip label="탑승" value={counts.탑승} color="#16a34a" />
            <CountChip label="픽업" value={counts.픽업} color="#db2777" />
            <CountChip label="결석" value={counts.결석} color="#dc2626" />
            <CountChip label="미탑승" value={counts.미탑승} color="#d97706" />
            <CountChip label="예정" value={counts.예정} color="#94a3b8" />
          </div>
          {roster.length > 0 && (
            <button onClick={onToggleExpand} className="w-fit text-[11px] font-semibold text-blue-600">
              {expanded ? "학생 목록 접기 ▲" : `학생 목록 보기 (${roster.length}명) ▼`}
            </button>
          )}
        </div>
      </div>

      {expanded && roster.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-slate-100 px-4 py-2">
          {roster.map((r) => {
            const b = boardingByAssignment[r.assignmentId];
            const status = b?.status ?? "예정";
            const color =
              status === "탑승" ? "#16a34a" : status === "픽업" ? "#db2777" : status === "결석" ? "#dc2626" : status === "미탑승" ? "#d97706" : "#94a3b8";
            return (
              <div key={r.assignmentId} className="flex items-center justify-between py-0.5 text-xs">
                <span className="text-slate-700">{r.studentName}</span>
                <span className="flex items-center gap-1.5">
                  {b?.alighted_at && <span className="text-[10px] text-blue-500">하차</span>}
                  <span className="font-semibold" style={{ color }}>
                    {status}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CountChip({ label, value, color }: { label: string; value: number; color: string }) {
  if (value === 0) return null;
  return (
    <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: `${color}18`, color }}>
      {label} {value}
    </span>
  );
}

// PilotMonitorClient의 지도와 같은 방식(마지막 위치 하나만 표시)이지만, 카드가 더 좁아서 크기만
// 줄인 버전입니다.
function LiveMiniMap({ lat, lng }: { lat?: number; lng?: number }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapObjRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kakao = await loadKakaoMaps();
      if (cancelled || !mapDivRef.current) return;
      const center = new kakao.maps.LatLng(lat ?? 37.5, lng ?? 127.0);
      if (!mapObjRef.current) {
        mapObjRef.current = new kakao.maps.Map(mapDivRef.current, { center, level: 6 });
      }
      if (lat != null && lng != null) {
        const pos = new kakao.maps.LatLng(lat, lng);
        if (!markerRef.current) {
          markerRef.current = new kakao.maps.Marker({ position: pos, map: mapObjRef.current });
        } else {
          markerRef.current.setPosition(pos);
        }
        mapObjRef.current.setCenter(pos);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return (
    <div className="h-[120px] w-full overflow-hidden rounded-lg bg-slate-100">
      {lat == null ? (
        <div className="flex h-full items-center justify-center text-center text-[11px] text-slate-400">위치 없음</div>
      ) : (
        <div ref={mapDivRef} className="h-full w-full" />
      )}
    </div>
  );
}
