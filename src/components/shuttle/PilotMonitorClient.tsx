"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { useToast } from "@/components/common/ToastProvider";
import type { ShuttlePilotPing, ShuttlePilotRoute, ShuttleRoute, ShuttleRunEvent } from "@/lib/types";

const POLL_MS = 7000;
const EXPECTED_INTERVAL_S = 5; // 체크인 페이지가 보내기로 한 주기(검증 기준 계산의 분모)

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
  const [now, setNow] = useState(() => Date.now());

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
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

  // 실시간 채널 대신 짧은 주기 조회(폴링)로 최신 위치·이벤트를 가져옵니다 - 기존 채팅·알림 등이
  // 쓰는 Supabase 실시간 자원과 전혀 경합하지 않고, 이 파일럿만의 부하로 완전히 격리됩니다.
  useEffect(() => {
    if (pilots.length === 0) return;
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);

    async function poll() {
      const results = await Promise.all(
        pilots.map(async (p) => {
          const [pingsRes, eventsRes] = await Promise.all([
            supabase
              .from("shuttle_pilot_pings")
              .select("*")
              .eq("route_id", p.route_id)
              .order("recorded_at", { ascending: false })
              .limit(200),
            supabase
              .from("shuttle_run_events")
              .select("*")
              .eq("route_id", p.route_id)
              .eq("service_date", today)
              .order("created_at", { ascending: true }),
          ]);
          return {
            routeId: p.route_id,
            pings: (pingsRes.data as ShuttlePilotPing[] | null) ?? [],
            events: (eventsRes.data as ShuttleRunEvent[] | null) ?? [],
          };
        })
      );
      setPingsByRoute(Object.fromEntries(results.map((r) => [r.routeId, r.pings])));
      setEventsByRoute(Object.fromEntries(results.map((r) => [r.routeId, r.events])));
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

  function copyLink(token: string) {
    const link = `${window.location.origin}/shuttle-pilot/${token}`;
    navigator.clipboard.writeText(link).then(
      () => notify("링크를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
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

      {pilots.map((pilot) => {
        const route = routeById.get(pilot.route_id);
        const pings = pingsByRoute[pilot.route_id] ?? [];
        const events = eventsByRoute[pilot.route_id] ?? [];
        return (
          <PilotRouteCard
            key={pilot.id}
            pilot={pilot}
            route={route}
            pings={pings}
            events={events}
            now={now}
            onCopyLink={() => copyLink(pilot.token)}
            onToggleEnabled={() => toggleEnabled(pilot)}
          />
        );
      })}
    </div>
  );
}

function PilotRouteCard({
  pilot,
  route,
  pings,
  events,
  now,
  onCopyLink,
  onToggleEnabled,
}: {
  pilot: ShuttlePilotRoute;
  route: ShuttleRoute | undefined;
  pings: ShuttlePilotPing[]; // recorded_at 내림차순(최신이 [0])
  events: ShuttleRunEvent[]; // created_at 오름차순
  now: number;
  onCopyLink: () => void;
  onToggleEnabled: () => void;
}) {
  const last = pings[0];
  const freshnessSec = last ? Math.max(0, Math.round((now - new Date(last.recorded_at).getTime()) / 1000)) : null;

  const tenMinAgo = now - 10 * 60 * 1000;
  const recent = pings.filter((p) => new Date(p.recorded_at).getTime() >= tenMinAgo);
  // 최근 10분 동안 5초 주기로 왔다면 몇 건이어야 하는지(분모) 대비 실제 수신 건수(분자) 비율.
  const expectedInWindow = Math.max(1, Math.round((10 * 60) / EXPECTED_INTERVAL_S));
  const successRate = recent.length > 0 ? Math.min(100, Math.round((recent.length / expectedInWindow) * 100)) : null;

  // 최근 수신분(최대 20개)의 연속 간격 평균 - 설계한 5초 주기에 실제로 얼마나 가까운지 확인용.
  const intervalSamples: number[] = [];
  for (let i = 0; i < Math.min(pings.length - 1, 20); i++) {
    const diff = (new Date(pings[i].recorded_at).getTime() - new Date(pings[i + 1].recorded_at).getTime()) / 1000;
    if (diff > 0 && diff < 120) intervalSamples.push(diff);
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
          <button onClick={onCopyLink} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            🔗 링크 복사
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="마지막 수신" value={freshnessSec == null ? "-" : `${freshnessSec}초 전`} warn={freshnessSec != null && freshnessSec >= 20 && running} />
          <Metric label="최근 10분 수신 성공률" value={successRate == null ? "-" : `${successRate}%`} warn={successRate != null && successRate < 80} />
          <Metric label="평균 갱신 간격" value={avgInterval == null ? "-" : `${avgInterval.toFixed(1)}초`} warn={avgInterval != null && Math.abs(avgInterval - EXPECTED_INTERVAL_S) > 5} />
          <Metric label="위치 정확도" value={last?.accuracy != null ? `약 ${Math.round(last.accuracy)}m` : "-"} />
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
