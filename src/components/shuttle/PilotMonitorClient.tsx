"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { todayKst } from "@/lib/kst";
import { createClient } from "@/lib/supabase/client";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { useToast } from "@/components/common/ToastProvider";
import type { ShuttlePilotPing, ShuttlePilotRoute, ShuttleRoute, ShuttleRunEvent, ShuttleSafetyEvent } from "@/lib/types";

// 안전운행지수(3단계-a) - 급가속·급감속 1건당 5점씩 깎습니다(정교한 보험사식 가중치가 아니라,
// "오늘 얼마나 급격한 순간이 많았는지"를 한눈에 보는 용도의 단순 지표입니다).
const SAFETY_PENALTY_PER_EVENT = 5;

const POLL_MS = 7000;
// 이 화면의 "수신 성공률"은 **웹 체크인 페이지가 5초마다 보내던 시절**의 기준이었습니다.
//
// 지금은 Traccar가 30초 간격 + 30m 거리 필터로 보냅니다. 멈춰 있을 때는 아예 안 보내고,
// 달릴 때는 30m마다 보내므로 몇 초 간격이 됩니다. 즉 **일정한 주기가 없습니다.**
// 그런데 분모를 5초로 고정해 두어서 정상 동작인데도 47%처럼 나왔고, 담당자가 "30m로
// 바꿔서 이러는 건가" 하고 걱정하게 됐습니다. 없는 문제를 화면이 만들어낸 셈입니다.
//
// 주기가 없는 자료에 "성공률"은 쓸 수 없습니다. 그래서 **실제로 판단에 쓰이는 것**으로
// 바꿉니다 - 몇 건 들어왔는지, 그리고 **가장 오래 끊긴 구간이 얼마인지**.
// 끊김이 길면 그 사이 정류장을 통째로 놓치므로, 이게 진짜 봐야 할 숫자입니다.
const GAP_WARN_S = 120;

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

export default function PilotMonitorClient({
  routes,
  initialPilots,
}: {
  routes: ShuttleRoute[];
  initialPilots: ShuttlePilotRoute[];
}) {
  const notify = useToast();
  const [pilots, setPilots] = useState(initialPilots);
  const [newRouteId, setNewRouteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [pingsByRoute, setPingsByRoute] = useState<Record<string, ShuttlePilotPing[]>>({});
  const [eventsByRoute, setEventsByRoute] = useState<Record<string, ShuttleRunEvent[]>>({});
  const [safetyByRoute, setSafetyByRoute] = useState<Record<string, ShuttleSafetyEvent[]>>({});
  const [now, setNow] = useState(() => Date.now());

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  // GPS 미연결 목록은 기본으로 접어둡니다 - 지금은 기기가 1대라 거의 전부가 여기 들어갑니다.
  const [showNoGps, setShowNoGps] = useState(false);
  const pilotedRouteIds = useMemo(() => new Set(pilots.map((p) => p.route_id)), [pilots]);
  const availableRoutes = useMemo(
    () => routes.filter((r) => !pilotedRouteIds.has(r.id)).sort((a, b) => natCompare(a.route_no, b.route_no)),
    [routes, pilotedRouteIds]
  );

  // 화면 표시용 "n초 전" 갱신 - 1초마다 시계만 다시 그립니다(데이터 재조회는 아래 폴링이 따로 함).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 예전에는 파일럿(노선)마다 위치·이벤트·안전이벤트 3개씩 따로 조회해서(요청: "실시간 반영
  // 속도 더 개선"하는 김에 발견한 비효율 - 파일럿이 10개면 매 폴링마다 쿼리가 30개), 노선이
  // 늘수록 요청 수가 그만큼 늘어 느려지는 구조였습니다. route_id를 한 번에 in(...)으로 묶어
  // 테이블당 쿼리 1개씩(총 3개)으로 줄였습니다 - 파일럿이 몇 개든 요청 수는 그대로입니다.
  useEffect(() => {
    if (pilots.length === 0) return;
    const supabase = createClient();
    const today = todayKst();
    const routeIds = pilots.map((p) => p.route_id);

    async function poll() {
      // 화면에서 실제로 쓰는 건 최근 10분 이내(신선도·수신주기 계산)뿐이라(아래 recent/
      // intervalSamples 참고), row 개수로 자르는 대신 시간으로 잘라야 노선마다 공평합니다 -
      // 한 노선이 유난히 자주 핑을 보내도 다른 노선 몫을 뺏어가지 않습니다.
      const pingCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const [pingsRes, eventsRes, safetyRes] = await Promise.all([
        supabase.from("shuttle_pilot_pings").select("*").in("route_id", routeIds).gte("recorded_at", pingCutoff).order("recorded_at", { ascending: false }),
        supabase.from("shuttle_run_events").select("*").in("route_id", routeIds).eq("service_date", today).order("created_at", { ascending: true }),
        supabase.from("shuttle_safety_events").select("*").in("route_id", routeIds).eq("service_date", today),
      ]);

      const pingsByRouteMap: Record<string, ShuttlePilotPing[]> = {};
      for (const p of (pingsRes.data as ShuttlePilotPing[] | null) ?? []) {
        (pingsByRouteMap[p.route_id] ??= []).push(p);
      }
      const eventsByRouteMap: Record<string, ShuttleRunEvent[]> = {};
      for (const e of (eventsRes.data as ShuttleRunEvent[] | null) ?? []) {
        (eventsByRouteMap[e.route_id] ??= []).push(e);
      }
      const safetyByRouteMap: Record<string, ShuttleSafetyEvent[]> = {};
      for (const s of (safetyRes.data as ShuttleSafetyEvent[] | null) ?? []) {
        (safetyByRouteMap[s.route_id] ??= []).push(s);
      }
      setPingsByRoute(pingsByRouteMap);
      setEventsByRoute(eventsByRouteMap);
      setSafetyByRoute(safetyByRouteMap);
    }

    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [pilots]);

  async function createPilot() {
    if (!newRouteId) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("shuttle_pilot_routes")
      .insert({ route_id: newRouteId })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("파일럿 링크를 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setPilots((prev) => [data as ShuttlePilotRoute, ...prev]);
    setNewRouteId("");
  }

  async function toggleEnabled(pilot: ShuttlePilotRoute) {
    const supabase = createClient();
    const next = !pilot.enabled;
    setPilots((prev) => prev.map((p) => (p.id === pilot.id ? { ...p, enabled: next } : p)));
    const { error } = await supabase.from("shuttle_pilot_routes").update({ enabled: next }).eq("id", pilot.id);
    if (error) notify("변경하지 못했습니다: " + error.message, "error");
  }

  function pilotLinkUrl(token: string) {
    return `${window.location.origin}/shuttle-pilot/${token}`;
  }

  function copyLink(token: string) {
    const link = pilotLinkUrl(token);
    navigator.clipboard.writeText(link).then(
      () => notify("링크를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
  }

  // 요청: "링크복사와 함께 링크열기버튼도 만들어줘" - 복사만 하지 않고 바로 새 탭으로 열어서
  // 확인할 수 있게 합니다.
  function openLink(token: string) {
    window.open(pilotLinkUrl(token), "_blank");
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 활성 노선은 등록되는 즉시 자동으로 링크가 생깁니다(DB 트리거) - 이 폼은 예외적으로
          빠진 노선이 있을 때만 수동으로 채우는 용도입니다. */}
      {availableRoutes.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-bold text-slate-700">누락된 노선 링크 추가</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={newRouteId}
              onChange={(e) => setNewRouteId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">노선 선택...</option>
              {availableRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.direction} {r.route_no}호 {r.name ?? ""}
                </option>
              ))}
            </select>
            <button
              onClick={createPilot}
              disabled={!newRouteId || busy}
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              + 링크 만들기
            </button>
          </div>
        </div>
      )}

      {pilots.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">아직 노선 링크가 없습니다. 활성 노선을 등록하면 자동으로 만들어집니다.</p>
      )}

      {/* GPS가 붙은 노선과 아직 안 붙은 노선을 나눠 보여줍니다.
          담당자: "기록분석도 GPS 연결과 미연결을 구별해서 두 줄로 나오도록 해줘."
          지금은 기기가 1대뿐이라 목록 대부분이 빈 카드입니다. 섞여 있으면 실제로 신호가
          들어오는 노선을 찾는 데만 한참 걸립니다. */}
      {(() => {
        const withGps = pilots.filter((p) => (pingsByRoute[p.route_id] ?? []).length > 0);
        const withoutGps = pilots.filter((p) => (pingsByRoute[p.route_id] ?? []).length === 0);
        const card = (pilot: (typeof pilots)[number]) => (
          <PilotRouteCard
            key={pilot.id}
            pilot={pilot}
            route={routeById.get(pilot.route_id)}
            pings={pingsByRoute[pilot.route_id] ?? []}
            events={eventsByRoute[pilot.route_id] ?? []}
            safety={safetyByRoute[pilot.route_id] ?? []}
            now={now}
            onCopyLink={() => copyLink(pilot.token)}
            onOpenLink={() => openLink(pilot.token)}
            onToggleEnabled={() => toggleEnabled(pilot)}
          />
        );
        return (
          <>
            <div className="flex items-center gap-2 pt-1">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                🟢 GPS 연결 {withGps.length}
              </span>
              <span className="h-px flex-1 bg-emerald-200" />
            </div>
            {withGps.length === 0 ? (
              <p className="px-1 py-2 text-xs text-slate-400">최근 신호가 들어온 노선이 없습니다.</p>
            ) : (
              withGps.map(card)
            )}

            <div className="flex items-center gap-2 pt-3">
              <button
                type="button"
                onClick={() => setShowNoGps((v) => !v)}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-200"
              >
                {showNoGps ? "▾" : "▸"} ⚪ GPS 미연결 {withoutGps.length}
              </button>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            {showNoGps && withoutGps.map(card)}
          </>
        );
      })()}
    </div>
  );
}

function PilotRouteCard({
  pilot,
  route,
  pings,
  events,
  safety,
  now,
  onCopyLink,
  onOpenLink,
  onToggleEnabled,
}: {
  pilot: ShuttlePilotRoute;
  route: ShuttleRoute | undefined;
  pings: ShuttlePilotPing[]; // recorded_at 내림차순(최신이 [0])
  events: ShuttleRunEvent[]; // created_at 오름차순
  safety: ShuttleSafetyEvent[]; // 오늘 이 노선의 급가속·급감속 이벤트
  now: number;
  onCopyLink: () => void;
  onOpenLink: () => void;
  onToggleEnabled: () => void;
}) {
  const last = pings[0];
  const freshnessSec = last ? Math.max(0, Math.round((now - new Date(last.recorded_at).getTime()) / 1000)) : null;

  const tenMinAgo = now - 10 * 60 * 1000;
  const recent = pings.filter((p) => new Date(p.recorded_at).getTime() >= tenMinAgo);
  // 최근 10분 수신 건수. 거리 필터 때문에 "정상값"이 정해져 있지 않으므로 비율이 아니라
  // 건수 그대로 봅니다(0이면 문제, 그 밖에는 도로 사정에 따라 달라지는 게 정상).
  const recentCount = recent.length;

  // 최근 10분 안에서 **가장 오래 끊긴 구간**. 이게 진짜 위험 신호입니다 - 3분이 비면
  // 그 사이에 지나간 정류장은 아무 기록도 남지 않습니다.
  let maxGap: number | null = null;
  const intervalSamples: number[] = [];
  for (let i = 0; i < recent.length - 1; i++) {
    const diff = (new Date(recent[i].recorded_at).getTime() - new Date(recent[i + 1].recorded_at).getTime()) / 1000;
    if (diff <= 0) continue;
    if (maxGap == null || diff > maxGap) maxGap = diff;
    if (diff < 120) intervalSamples.push(diff);
  }
  const avgInterval = intervalSamples.length > 0 ? intervalSamples.reduce((a, b) => a + b, 0) / intervalSamples.length : null;

  const startEvent = events.find((e) => e.event === "출발");
  const endEvent = [...events].reverse().find((e) => e.event === "도착");
  const running = !!startEvent && !endEvent;
  const durationMin =
    startEvent && endEvent
      ? Math.round((new Date(endEvent.created_at).getTime() - new Date(startEvent.created_at).getTime()) / 60000)
      : null;

  const fresh = freshnessSec != null && freshnessSec < 20;

  const accelCount = safety.filter((s) => s.event_type === "급가속").length;
  const decelCount = safety.filter((s) => s.event_type === "급감속").length;
  const safetyScore = Math.max(0, 100 - (accelCount + decelCount) * SAFETY_PENALTY_PER_EVENT);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-800">
            {route ? `${route.direction} ${route.route_no}호 ${route.name ?? ""}` : "노선 정보 없음"}
          </p>
          <p className="text-xs text-slate-400">
            {running ? (
              <span className="font-semibold text-blue-600">🔵 운행중{fresh ? "" : " · 수신 지연"}</span>
            ) : endEvent ? (
              <span className="text-emerald-600">완주 · {durationMin}분 소요</span>
            ) : (
              <span>대기중(운행 시작 전)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.open(`/api/shuttle/run-log/pdf?routeId=${pilot.route_id}&date=${todayKst()}`, "_blank")}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            📋 오늘 운행일지
          </button>
          <button onClick={onCopyLink} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            🔗 링크 복사
          </button>
          <button onClick={onOpenLink} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ↗ 링크 열기
          </button>
          <button
            onClick={onToggleEnabled}
            className={"rounded-lg px-2.5 py-1 text-xs font-semibold " + (pilot.enabled ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")}
          >
            {pilot.enabled ? "링크 끄기" : "링크 켜기"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-[220px_1fr]">
        <PilotLiveMap lat={last?.lat} lng={last?.lng} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Metric label="마지막 수신" value={freshnessSec == null ? "-" : `${freshnessSec}초 전`} warn={freshnessSec != null && freshnessSec >= 20 && running} />
          <Metric label="최근 10분 수신" value={`${recentCount}건`} warn={running && recentCount === 0} />
          {/* 정해진 주기가 없으므로(거리 필터) 평균 간격은 참고용입니다. 경고는 걸지 않습니다. */}
          <Metric label="평균 간격 (참고)" value={avgInterval == null ? "-" : `${avgInterval.toFixed(1)}초`} />
          <Metric
            label="가장 긴 끊김"
            value={maxGap == null ? "-" : maxGap >= 60 ? `${Math.round(maxGap / 60)}분 ${Math.round(maxGap % 60)}초` : `${Math.round(maxGap)}초`}
            warn={maxGap != null && maxGap > GAP_WARN_S}
          />
          <Metric label="위치 정확도" value={last?.accuracy != null ? `약 ${Math.round(last.accuracy)}m` : "-"} />
          <Metric
            label="오늘 안전운행지수"
            value={accelCount + decelCount === 0 ? "100점" : `${safetyScore}점 (급가속${accelCount}·급감속${decelCount})`}
            warn={safetyScore < 80}
          />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={"rounded-lg px-2.5 py-2 " + (warn ? "bg-amber-50" : "bg-slate-50")}>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={"text-sm font-bold " + (warn ? "text-amber-700" : "text-slate-700")}>{value}</p>
    </div>
  );
}

// 파일럿 노선 하나의 마지막 위치만 찍는 작은 지도입니다(RouteMap.tsx처럼 정류장 전체를 그리지
// 않고, 검증 목적에 맞게 "지금 여기 있다"만 확인하면 되므로 훨씬 가볍게 만들었습니다).
function PilotLiveMap({ lat, lng }: { lat?: number; lng?: number }) {
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
    <div className="h-[180px] w-full overflow-hidden rounded-lg bg-slate-100 sm:h-full sm:min-h-[140px]">
      {lat == null ? (
        <div className="flex h-full items-center justify-center text-xs text-slate-400">아직 수신된 위치가 없습니다</div>
      ) : (
        <div ref={mapDivRef} className="h-full w-full" />
      )}
    </div>
  );
}
