"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { geocodeAddress, loadKakaoMaps } from "@/lib/kakaoMap";
import type { ShuttleRoutePath, ShuttleStop } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Kakao = any;

const DEFAULT_CENTER = { lat: 37.5172, lng: 127.0473 }; // 강남/논현 일대 기본값(좌표를 하나도 못 구했을 때)

// GIA마이크로랩(학교) 주소 - 등원 노선은 항상 이 지점에서 끝나고, 하원 노선은 항상 이 지점에서
// 출발합니다. 정류장 DB에는 학생 주소만 들어있어 학교 지점이 없으므로, 지도에는 이 좌표를
// 매번 방향에 맞는 끝에 덧붙여 그립니다.
const GIA_ADDRESS = "서울 강남구 논현로131길 45";
let giaCoordCache: { lat: number; lng: number } | null = null; // 노선을 바꿔도 같은 세션이면 다시 지오코딩하지 않도록 모듈 스코프에 캐시합니다.

// "8:27" / "08:27:00" 등을 자정 기준 분(0~1439)으로 바꿉니다.
function timeToMinutes(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function minutesToTime(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
  const m = Math.round(min) % 60;
  return `${String(h).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
}

export default function RouteMap({
  routeId,
  stops,
  direction,
  routeLabel,
  departTime,
  canEdit,
  focusStopId,
}: {
  routeId: string;
  stops: ShuttleStop[]; // 이미 seq 오름차순으로 정렬되어 들어온다고 가정합니다.
  direction: "등원" | "하원";
  routeLabel: string;
  departTime: string; // 이 노선의 등록된 출발 기준시각(HH:MM)
  canEdit: boolean;
  focusStopId?: string | null; // 목록에서 정류장을 클릭하면 그 정류장으로 지도를 이동합니다(요청 ⑬).
}) {
  const notify = useToast();
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<Kakao>(null);
  const markersRef = useRef<Kakao[]>([]);
  const lineRef = useRef<Kakao>(null);
  const clickListenerRef = useRef<Kakao>(null);

  const [localStops, setLocalStops] = useState(stops);

  // 목록에서 정류장을 클릭하면(focusStopId) 그 정류장 좌표로 지도를 부드럽게 이동·확대합니다.
  useEffect(() => {
    if (!focusStopId) return;
    const map = mapObjRef.current as { panTo?: (v: unknown) => void; setLevel?: (n: number) => void } | null;
    const kakao = (window as unknown as { kakao?: { maps?: { LatLng: new (a: number, b: number) => unknown } } }).kakao;
    if (!map || !kakao?.maps) return;
    const s = localStops.find((x) => x.id === focusStopId);
    if (s && s.lat != null && s.lng != null) {
      map.setLevel?.(3);
      map.panTo?.(new kakao.maps.LatLng(s.lat, s.lng));
    }
  }, [focusStopId, localStops]);
  const [giaCoord, setGiaCoord] = useState<{ lat: number; lng: number } | null>(giaCoordCache);
  const [sdkStatus, setSdkStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sdkError, setSdkError] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [pinTarget, setPinTarget] = useState<string | null>(null); // 지도를 클릭해 좌표를 지정할 정류장 id
  const [routePath, setRoutePath] = useState<ShuttleRoutePath | null>(null);
  const [pathComputing, setPathComputing] = useState(false);
  const autoTriedRef = useRef<Set<string>>(new Set());

  useEffect(() => setLocalStops(stops), [stops]);

  const missing = localStops.filter((s) => s.address && (s.lat == null || s.lng == null));
  const geocoded = localStops.filter((s) => s.lat != null && s.lng != null);
  const currentStopIds = geocoded.map((s) => s.id);
  const pathStale = !routePath || routePath.stop_ids.length !== currentStopIds.length || routePath.stop_ids.some((id, i) => id !== currentStopIds[i]);

  // 지도 마커와 아래쪽 시간표가 같은 순서를 쓰도록 한 곳에서만 계산합니다. 등원은 정류장을 돈
  // 뒤 GIA에서 끝나고, 하원은 GIA에서 출발해 정류장을 순서대로 돕니다.
  const orderedPoints = useMemo(() => {
    const stopPts = geocoded.map((s) => ({
      key: s.id,
      lat: s.lat!,
      lng: s.lng!,
      label: String(s.seq),
      address: s.address ?? "",
      isSchool: false,
    }));
    const schoolPt = giaCoord
      ? { key: "gia", lat: giaCoord.lat, lng: giaCoord.lng, label: "GIA", address: "GIA 본원(논현로131길 45)", isSchool: true }
      : null;
    if (!schoolPt) return stopPts;
    return direction === "등원" ? [...stopPts, schoolPt] : [schoolPt, ...stopPts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geocoded, giaCoord, direction]);

  // 이 노선의 캐시된 실제 도로 경로를 불러옵니다(노선을 바꿀 때마다).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase.from("shuttle_route_paths").select("*").eq("route_id", routeId).maybeSingle();
      if (!cancelled) setRoutePath((data as ShuttleRoutePath | null) ?? null);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  async function computeRoadPath(auto = false) {
    if (!giaCoord) {
      if (!auto) notify("GIA 본원 좌표를 아직 못 찾았습니다. 잠시 후 다시 시도해주세요.", "error");
      return;
    }
    setPathComputing(true);
    try {
      const res = await fetch("/api/shuttle/route-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId, giaLat: giaCoord.lat, giaLng: giaCoord.lng }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (!auto) notify(json.error ?? "실제 도로 경로 계산에 실패했습니다.", "error");
        return;
      }
      setRoutePath({
        route_id: routeId,
        path: json.path,
        distance_m: json.distance_m,
        duration_s: json.duration_s,
        legs: json.legs ?? [],
        stop_ids: json.stop_ids,
        computed_at: new Date().toISOString(),
      });
      if (!auto) notify("실제 도로 경로를 계산했습니다.", "success");
    } catch {
      if (!auto) notify("실제 도로 경로 계산 중 오류가 발생했습니다.", "error");
    } finally {
      setPathComputing(false);
    }
  }

  // 노선을 열었는데 실도로 경로가 아직 없거나(또는 정류장이 바뀌어 낡았으면), 편집 권한이 있는
  // 사용자에 한해 자동으로 한 번 계산해둡니다(매번 손으로 버튼을 누르지 않아도 되도록). 실패해도
  // 이 노선에서는 다시 자동 시도하지 않고(같은 실패가 반복 호출되는 것을 막음) 수동 버튼으로 재시도할 수 있습니다.
  useEffect(() => {
    if (!canEdit || !giaCoord || geocoded.length === 0) return;
    if (routePath && !pathStale) return;
    if (autoTriedRef.current.has(routeId)) return;
    autoTriedRef.current.add(routeId);
    computeRoadPath(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, giaCoord, geocoded.length, pathStale, routePath, routeId]);

  // 지도 SDK를 불러오고, 이 노선에 속한 정류장 중 좌표가 없는 것들을 순서대로 자동 지오코딩합니다.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !mapDivRef.current) return;
        if (!mapObjRef.current) {
          mapObjRef.current = new kakao.maps.Map(mapDivRef.current, {
            center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
            level: 7,
          });
        }
        setSdkStatus("ready");

        // GIA 본원 좌표는 노선마다 공통이라 한 번만 지오코딩하고 모듈 캐시에 저장해둡니다.
        if (!giaCoordCache) {
          const schoolCoord = await geocodeAddress(GIA_ADDRESS);
          if (schoolCoord) {
            giaCoordCache = { lat: schoolCoord.lat, lng: schoolCoord.lng };
            if (!cancelled) setGiaCoord(giaCoordCache);
          }
        }

        // 주소는 있는데 좌표나 구/동 정보가 없는 정류장을 하나씩 지오코딩(카카오 API가 콜백
        // 기반이라 순차 처리). 구/동은 지역별 대시보드 분류 기준이라, 기존에 좌표만 있고 구/동은
        // 아직 없는 정류장도 이 화면을 열 때마다 자연스럽게 채워집니다.
        const toGeocode = stops.filter((s) => s.address && (s.lat == null || s.lng == null || s.gu == null));
        if (toGeocode.length > 0) {
          setGeocoding(true);
          const supabase = createClient();
          for (const s of toGeocode) {
            if (cancelled) break;
            const result = await geocodeAddress(s.address!);
            if (result) {
              await supabase
                .from("shuttle_stops")
                .update({ lat: result.lat, lng: result.lng, gu: result.gu, dong: result.dong, geocoded_at: new Date().toISOString() })
                .eq("id", s.id);
              if (!cancelled) {
                setLocalStops((prev) => prev.map((p) => (p.id === s.id ? { ...p, ...result } : p)));
              }
            }
          }
          if (!cancelled) setGeocoding(false);
        }
      } catch (e) {
        if (!cancelled) {
          setSdkStatus("error");
          setSdkError(e instanceof Error ? e.message : "지도를 불러오지 못했습니다.");
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  // 좌표가 채워질 때마다 마커/경로선을 다시 그립니다.
  useEffect(() => {
    async function render() {
      if (sdkStatus !== "ready") return;
      const kakao = await loadKakaoMaps();
      const map = mapObjRef.current;
      if (!map) return;

      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      lineRef.current?.setMap(null);
      lineRef.current = null;

      const pts = orderedPoints;
      if (pts.length === 0) return;

      const path: Kakao[] = [];
      pts.forEach((p) => {
        const pos = new kakao.maps.LatLng(p.lat, p.lng);
        path.push(pos);
        const overlay = new kakao.maps.CustomOverlay({
          position: pos,
          yAnchor: 1,
          content: p.isSchool
            ? `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
                <div style="background:#0f172a;color:#fff;border-radius:9999px;
                  padding:2px 8px;display:flex;align-items:center;justify-content:center;
                  font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">
                  🏫 GIA
                </div>
              </div>`
            : `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
            <div style="background:${direction === "등원" ? "#d97706" : "#4f46e5"};color:#fff;border-radius:9999px;
              width:22px;height:22px;display:flex;align-items:center;justify-content:center;
              font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">
              ${p.label}
            </div>
          </div>`,
        });
        overlay.setMap(map);
        markersRef.current.push(overlay);
      });

      // 실제 도로 경로가 계산돼 있고(정류장 구성이 바뀌지 않아) 최신이면 그 도로 좌표를 그대로
      // 따라가는 선을 그리고, 아직 없으면 정류장 사이를 직선으로 잇습니다.
      const useRoadPath = routePath && !pathStale && routePath.path.length >= 2;
      const linePath = useRoadPath ? routePath!.path.map((p) => new kakao.maps.LatLng(p.lat, p.lng)) : path;

      if (linePath.length >= 2) {
        const polyline = new kakao.maps.Polyline({
          path: linePath,
          strokeWeight: 4,
          strokeColor: direction === "등원" ? "#d97706" : "#4f46e5",
          strokeOpacity: useRoadPath ? 0.85 : 0.6,
          strokeStyle: "solid",
        });
        polyline.setMap(map);
        lineRef.current = polyline;
      }

      const bounds = new kakao.maps.LatLngBounds();
      linePath.forEach((p: Kakao) => bounds.extend(p));
      path.forEach((p) => bounds.extend(p));
      map.setBounds(bounds, 60, 60, 60, 60);
    }
    render();
  }, [orderedPoints, sdkStatus, direction, routePath, pathStale]);

  // 수동 좌표 지정 모드: 지도를 클릭하면 그 위치를 pinTarget 정류장의 좌표로 저장합니다.
  useEffect(() => {
    async function attach() {
      const kakao = await loadKakaoMaps();
      const map = mapObjRef.current;
      if (!map) return;
      if (clickListenerRef.current) {
        kakao.maps.event.removeListener(map, "click", clickListenerRef.current);
        clickListenerRef.current = null;
      }
      if (!pinTarget) return;
      const handler = async (e: Kakao) => {
        const lat = e.latLng.getLat();
        const lng = e.latLng.getLng();
        const supabase = createClient();
        const { error } = await supabase
          .from("shuttle_stops")
          .update({ lat, lng, geocoded_at: new Date().toISOString() })
          .eq("id", pinTarget);
        if (error) {
          notify("좌표를 저장하지 못했습니다: " + error.message, "error");
          return;
        }
        setLocalStops((prev) => prev.map((p) => (p.id === pinTarget ? { ...p, lat, lng } : p)));
        setPinTarget(null);
        notify("좌표를 지정했습니다.", "success");
      };
      clickListenerRef.current = handler;
      kakao.maps.event.addListener(map, "click", handler);
    }
    if (sdkStatus === "ready") attach();
  }, [pinTarget, sdkStatus, notify]);

  // 정류장별 소요시간·도착예정시간 표. 실도로 경로(구간별 소요시간)가 최신일 때만 실제 시간을
  // 계산하고, 없으면 순서·주소만 보여줍니다(엉뚱한 시간을 보여주지 않기 위함).
  const hasLegTimes = !!routePath && !pathStale && routePath.legs.length === orderedPoints.length - 1 && orderedPoints.length > 1;
  const baseMin = timeToMinutes(departTime);
  const scheduleRows = useMemo(() => {
    if (baseMin == null || orderedPoints.length === 0) return [];
    let cum = baseMin;
    return orderedPoints.map((p, i) => {
      let legMinutes: number | null = null;
      let arrival: number | null = i === 0 ? baseMin : null;
      if (i > 0 && hasLegTimes) {
        legMinutes = Math.round(routePath!.legs[i - 1].duration_s / 60);
        cum += legMinutes;
        arrival = cum;
      }
      return { ...p, arrival, legMinutes };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedPoints, hasLegTimes, baseMin]);

  if (!process.env.NEXT_PUBLIC_KAKAO_MAP_KEY) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-400">
        지도 기능을 쓰려면 카카오맵 키(NEXT_PUBLIC_KAKAO_MAP_KEY) 설정이 필요합니다.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {routeLabel} · 정류장 {localStops.length}곳 중 좌표 {geocoded.length}곳 표시
          {giaCoord && <span className="ml-1">· 🏫 GIA 본원 {direction === "등원" ? "도착점" : "출발점"} 표시</span>}
          {geocoding && <span className="ml-1 text-amber-600">· 주소로 좌표 찾는 중…</span>}
          {routePath && !pathStale && routePath.distance_m != null && (
            <span className="ml-1 text-emerald-600">
              · 🛣️ 실제 도로 총 {(routePath.distance_m / 1000).toFixed(1)}km · 약 {Math.round((routePath.duration_s ?? 0) / 60)}분
            </span>
          )}
          {routePath && pathStale && <span className="ml-1 text-amber-600">· 정류장이 바뀌어 경로를 다시 계산해야 합니다</span>}
        </p>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => computeRoadPath()}
              disabled={pathComputing || !giaCoord || geocoded.length === 0}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {pathComputing ? "계산 중…" : routePath && !pathStale ? "🛣️ 도로 경로 다시 계산" : "🛣️ 실제 도로 경로 계산"}
            </button>
          )}
          {pinTarget && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              지도를 클릭해 위치를 지정하세요 · <button onClick={() => setPinTarget(null)} className="underline">취소</button>
            </span>
          )}
        </div>
      </div>

      {sdkStatus === "error" ? (
        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-red-200 bg-red-50 p-6 text-center text-sm text-red-500">
          {sdkError || "지도를 불러오지 못했습니다."}
        </div>
      ) : (
        <div className="min-h-0 flex-[3] overflow-hidden rounded-xl border border-slate-200">
          <div ref={mapDivRef} className="h-full w-full" />
        </div>
      )}

      {missing.length > 0 && (
        <div className="max-h-32 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-[11px] font-semibold text-amber-700">
            ⚠️ 자동으로 위치를 못 찾은 정류장 {missing.length}곳 (동 이름만 있는 주소 등) - 눌러서 지도에 직접 표시하세요.
          </p>
          {missing.map((s) => (
            <button
              key={s.id}
              onClick={() => setPinTarget(s.id)}
              className={
                "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition " +
                (pinTarget === s.id ? "bg-amber-200" : "bg-white hover:bg-amber-100")
              }
            >
              <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 font-bold text-slate-600">{s.seq}</span>
              <span className="truncate text-slate-600">{s.address}</span>
            </button>
          ))}
        </div>
      )}

      {scheduleRows.length > 0 && (
        <div className="min-h-0 flex-[2] overflow-y-auto rounded-lg border border-slate-200 p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
            🕐 {minutesToTime(scheduleRows[0].arrival ?? baseMin ?? 0)} {scheduleRows[0].isSchool ? "GIA" : `${scheduleRows[0].label}번 정류장`} 출발
          </p>
          {!hasLegTimes && (
            <p className="mb-1.5 text-[11px] text-amber-600">
              위 [🛣️ 실제 도로 경로 계산]을 하면 정류장별 소요시간·도착예정시각이 채워집니다. 지금은 순서만 보여드립니다.
            </p>
          )}
          <ol className="space-y-1">
            {scheduleRows.slice(1).map((p) => (
              <li key={p.key} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px]">
                <span
                  className={
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white " +
                    (p.isSchool ? "bg-slate-800" : direction === "등원" ? "bg-amber-600" : "bg-indigo-600")
                  }
                >
                  {p.isSchool ? "GIA" : `${p.label}번`}
                </span>
                <span className="text-slate-600">{p.address}</span>
                {p.legMinutes != null && <span className="text-slate-400">(전 구간 {p.legMinutes}분)</span>}
                <span className="ml-auto shrink-0 font-semibold text-slate-700">
                  {p.arrival != null ? minutesToTime(p.arrival) : "-"} {p.isSchool ? "도착 예정" : "도착"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
