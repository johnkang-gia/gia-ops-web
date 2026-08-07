"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import type { ShuttleAssignment, ShuttleRoute, ShuttleStop } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Kakao = any;

const DEFAULT_CENTER = { lat: 37.5172, lng: 127.0473 };
const UNTAGGED = "(지역 미지정)";

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

// 노선을 번호순대로도 쓰지만, 실제로는 가는 지역을 묶어서 번호를 매긴 것이라 - "지금 이 지역
// 가는 차가 몇 호인지"를 지도에서 바로 찾아볼 수 있게 만든 대시보드입니다. 왼쪽 지도에서 지역을
// 고르면(또는 검색하면) 오른쪽에 그 지역 노선이, 아래에는 전체 노선이 지역순으로 나옵니다.
export default function ShuttleRegionDashboard({
  routes,
  stops,
  assignments,
}: {
  routes: ShuttleRoute[];
  stops: ShuttleStop[];
  assignments: Pick<ShuttleAssignment, "stop_id">[];
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<Kakao>(null);
  const overlaysRef = useRef<Kakao[]>([]);
  const [sdkStatus, setSdkStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);

  const stopsByRoute = useMemo(() => {
    const m = new Map<string, ShuttleStop[]>();
    for (const s of stops) {
      const arr = m.get(s.route_id) ?? [];
      arr.push(s);
      m.set(s.route_id, arr);
    }
    return m;
  }, [stops]);

  const riderCountByStop = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) m.set(a.stop_id, (m.get(a.stop_id) ?? 0) + 1);
    return m;
  }, [assignments]);

  const riderCountByRoute = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of routes) {
      const n = (stopsByRoute.get(r.id) ?? []).reduce((sum, s) => sum + (riderCountByStop.get(s.id) ?? 0), 0);
      m.set(r.id, n);
    }
    return m;
  }, [routes, stopsByRoute, riderCountByStop]);

  // 지역 -> 그 지역을 가는 노선들 (한 노선이 "용산/이태원"처럼 지역이 여러 개면 양쪽 모두에 들어갑니다).
  const routesByRegion = useMemo(() => {
    const m = new Map<string, ShuttleRoute[]>();
    for (const r of routes) {
      const regions = r.regions.length ? r.regions : [UNTAGGED];
      for (const reg of regions) {
        const arr = m.get(reg) ?? [];
        arr.push(r);
        m.set(reg, arr);
      }
    }
    for (const arr of m.values()) arr.sort((a, b) => natCompare(a.route_no, b.route_no));
    return m;
  }, [routes]);

  // 지역 중심좌표 = 그 지역 노선들이 지나는 정류장 좌표 평균(지도에 라벨을 놓을 위치).
  const regionCenters = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; routeCount: number }>();
    for (const [region, rs] of routesByRegion) {
      let sumLat = 0;
      let sumLng = 0;
      let n = 0;
      for (const r of rs) {
        for (const s of stopsByRoute.get(r.id) ?? []) {
          if (s.lat != null && s.lng != null) {
            sumLat += s.lat;
            sumLng += s.lng;
            n++;
          }
        }
      }
      if (n > 0) m.set(region, { lat: sumLat / n, lng: sumLng / n, routeCount: rs.length });
    }
    return m;
  }, [routesByRegion, stopsByRoute]);

  const q = query.trim().toLowerCase();
  const textMatches = (text: string) => !q || text.toLowerCase().includes(q);
  const routeMatchesQuery = (r: ShuttleRoute) =>
    !q ||
    textMatches(r.route_no) ||
    textMatches(r.name ?? "") ||
    r.regions.some((reg) => textMatches(reg)) ||
    (stopsByRoute.get(r.id) ?? []).some((s) => textMatches(s.address ?? ""));

  // 지도 초기화 (한 번만).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !mapDivRef.current) return;
        if (!mapObjRef.current) {
          mapObjRef.current = new kakao.maps.Map(mapDivRef.current, {
            center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
            level: 8,
          });
        }
        setSdkStatus("ready");
      } catch {
        if (!cancelled) setSdkStatus("error");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // 지역 라벨을 지도 위에 그립니다. 검색어에 안 걸리는 지역은 흐리게 표시해 눈에 덜 띄게 합니다.
  useEffect(() => {
    async function render() {
      if (sdkStatus !== "ready") return;
      const kakao = await loadKakaoMaps();
      const map = mapObjRef.current;
      if (!map) return;

      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];

      const bounds = new kakao.maps.LatLngBounds();
      let any = false;
      for (const [region, center] of regionCenters) {
        const pos = new kakao.maps.LatLng(center.lat, center.lng);
        bounds.extend(pos);
        any = true;
        const match = textMatches(region);
        const active = selectedRegion === region;

        const el = document.createElement("div");
        el.style.cssText = "cursor:pointer;transform:translate(-50%,-100%);opacity:" + (match ? "1" : "0.3") + ";";
        el.innerHTML = `<div style="display:flex;align-items:center;gap:4px;background:${active ? "#0f172a" : "#ffffff"};
            color:${active ? "#fff" : "#334155"};border:1.5px solid #0f172a;border-radius:9999px;
            padding:4px 10px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)">
            📍 ${region} · ${center.routeCount}대
          </div>`;
        el.onclick = () => setSelectedRegion((prev) => (prev === region ? null : region));

        const overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1 });
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      }
      if (any) map.setBounds(bounds, 50, 50, 50, 50);
    }
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionCenters, sdkStatus, selectedRegion, q]);

  const regionList = useMemo(() => [...routesByRegion.keys()].sort((a, b) => a.localeCompare(b, "ko")), [routesByRegion]);
  const rightRoutes = selectedRegion ? routesByRegion.get(selectedRegion) ?? [] : [];

  const fullList = useMemo(() => {
    return [...routes]
      .filter(routeMatchesQuery)
      .sort((a, b) => {
        const ra = (a.regions[0] ?? UNTAGGED).localeCompare(b.regions[0] ?? UNTAGGED, "ko");
        if (ra !== 0) return ra;
        return natCompare(a.route_no, b.route_no);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, q]);

  if (!process.env.NEXT_PUBLIC_KAKAO_MAP_KEY) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-400">
        지도 기능을 쓰려면 카카오맵 키(NEXT_PUBLIC_KAKAO_MAP_KEY) 설정이 필요합니다.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="지명·아파트·도로명·차호수로 검색 (예: 청담, 메이플자이, 22)"
        className="w-full max-w-md shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="flex min-h-0 flex-[3] gap-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200">
          {sdkStatus === "error" ? (
            <div className="flex h-full items-center justify-center text-sm text-red-500">지도를 불러오지 못했습니다.</div>
          ) : (
            <div ref={mapDivRef} className="h-full w-full" />
          )}
        </div>

        <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="max-h-36 shrink-0 overflow-y-auto border-b border-slate-100 p-2">
            <p className="mb-1 text-[10px] font-semibold text-slate-400">지역 목록 ({regionList.length})</p>
            <div className="flex flex-wrap gap-1">
              {regionList
                .filter((reg) => textMatches(reg))
                .map((reg) => (
                  <button
                    key={reg}
                    onClick={() => setSelectedRegion((prev) => (prev === reg ? null : reg))}
                    className={
                      "rounded-full px-2 py-1 text-[11px] transition " +
                      (selectedRegion === reg ? "bg-gia-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                    }
                  >
                    {reg} · {routesByRegion.get(reg)?.length}
                  </button>
                ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {!selectedRegion ? (
              <p className="py-8 text-center text-xs text-slate-400">지도나 위 지역 목록에서 지역을 선택하세요.</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-bold text-slate-700">
                  📍 {selectedRegion} 가는 셔틀 {rightRoutes.length}대
                </p>
                <div className="space-y-1.5">
                  {rightRoutes.map((r) => {
                    const count = riderCountByRoute.get(r.id) ?? 0;
                    const over = r.usable_capacity != null && count > r.usable_capacity;
                    return (
                      <div key={r.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={
                              "rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white " +
                              (r.direction === "등원" ? "bg-amber-600" : "bg-indigo-600")
                            }
                          >
                            {r.direction}
                          </span>
                          <span className="font-semibold text-slate-700">{r.route_no}호</span>
                          <span className="text-slate-400">{r.name}</span>
                        </div>
                        <div className="mt-0.5 text-slate-400">
                          🚐 {r.driver_name ?? "-"} {r.vehicle_no ? `· ${r.vehicle_no}` : ""}
                          <span className={over ? "ml-1 font-semibold text-red-600" : "ml-1"}>
                            · {count}명{r.usable_capacity != null ? `/${r.usable_capacity}` : ""}
                            {over && " ⚠️"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-[2] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-xs font-bold text-slate-700">전체 노선 - 지역순 · 호차 오름차순 ({fullList.length})</p>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400">
              <th className="py-1 pr-2">지역</th>
              <th className="py-1 pr-2">방향</th>
              <th className="py-1 pr-2">호차</th>
              <th className="py-1 pr-2">권역명</th>
              <th className="py-1 pr-2">기사님</th>
              <th className="py-1 pr-2">차량번호</th>
              <th className="py-1 pr-2">탑승인원</th>
            </tr>
          </thead>
          <tbody>
            {fullList.map((r) => {
              const count = riderCountByRoute.get(r.id) ?? 0;
              const over = r.usable_capacity != null && count > r.usable_capacity;
              return (
                <tr
                  key={r.id}
                  onClick={() => setSelectedRegion(r.regions[0] ?? UNTAGGED)}
                  className="cursor-pointer border-b border-slate-50 text-slate-600 hover:bg-slate-50"
                >
                  <td className="py-1 pr-2">{r.regions.join(", ") || UNTAGGED}</td>
                  <td className="py-1 pr-2">
                    <span
                      className={
                        "rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white " +
                        (r.direction === "등원" ? "bg-amber-600" : "bg-indigo-600")
                      }
                    >
                      {r.direction}
                    </span>
                  </td>
                  <td className="py-1 pr-2 font-semibold text-slate-700">{r.route_no}호</td>
                  <td className="py-1 pr-2">{r.name}</td>
                  <td className="py-1 pr-2">{r.driver_name ?? "-"}</td>
                  <td className="py-1 pr-2">{r.vehicle_no ?? "-"}</td>
                  <td className={"py-1 pr-2 " + (over ? "font-semibold text-red-600" : "")}>
                    {count}
                    {r.usable_capacity != null ? `/${r.usable_capacity}` : ""}
                    {over && " ⚠️"}
                  </td>
                </tr>
              );
            })}
            {fullList.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
