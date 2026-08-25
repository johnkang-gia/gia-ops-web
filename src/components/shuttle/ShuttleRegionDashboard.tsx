"use client";

import { useMemo, useState } from "react";
import SeoulGuMap from "@/components/shuttle/SeoulGuMap";
import type { ShuttleAssignment, ShuttleRoute, ShuttleStop } from "@/lib/types";

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

// 노선을 번호순대로도 쓰지만, 실제로는 학생 주소를 기준으로 가는 지역을 묶어서 번호를 매긴
// 것이라 - 서울 지도에서 구를 고르면(또는 지명·아파트·도로명·차호수로 검색하면) 그 구에 몇 대가
// 가는지, 그 안의 어느 동에 몇 호차가 가는지 바로 찾아볼 수 있게 만든 대시보드입니다.
// 지역 분류는 노선 이름표기(예: "청담1")가 아니라, 정류장 주소를 카카오로 지오코딩할 때 함께
// 받아오는 실제 행정구역(구/동)을 기준으로 합니다 - 노선 이름은 표기가 제각각이라 믿을 수 없었습니다.
export default function ShuttleRegionDashboard({
  routes,
  stops,
  assignments,
  hideList = false,
}: {
  routes: ShuttleRoute[];
  stops: ShuttleStop[];
  assignments: Pick<ShuttleAssignment, "stop_id">[];
  // 개요 상단에 지도만 크게 쓸 때(전체 노선 목록은 개요의 통합 표로 관리) 아래 리스트를 감춥니다.
  hideList?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedGu, setSelectedGu] = useState<string | null>(null);

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

  // 노선별로 실제 정류장 구/동을 모아둡니다(구/동은 지오코딩 결과 - 노선 하나가 여러 구를
  // 걸치기도 하고, 대표 구(정류장이 가장 많은 구)는 전체 목록 정렬에 씁니다.
  const routeGeo = useMemo(() => {
    const m = new Map<string, { gus: Set<string>; dongs: Set<string>; primaryGu: string | null }>();
    for (const r of routes) {
      const gus = new Set<string>();
      const dongs = new Set<string>();
      const guCount = new Map<string, number>();
      for (const s of stopsByRoute.get(r.id) ?? []) {
        if (s.gu) {
          gus.add(s.gu);
          guCount.set(s.gu, (guCount.get(s.gu) ?? 0) + 1);
        }
        if (s.dong) dongs.add(s.dong);
      }
      let primaryGu: string | null = null;
      let best = 0;
      for (const [g, c] of guCount) {
        if (c > best) {
          best = c;
          primaryGu = g;
        }
      }
      m.set(r.id, { gus, dongs, primaryGu });
    }
    return m;
  }, [routes, stopsByRoute]);

  // 구 -> 그 구로 가는 노선 수(지도 색칠/숫자 표시용).
  const guCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of routes) {
      for (const g of routeGeo.get(r.id)?.gus ?? []) m[g] = (m[g] ?? 0) + 1;
    }
    return m;
  }, [routes, routeGeo]);

  const q = query.trim().toLowerCase();
  const textMatches = (text: string) => !q || text.toLowerCase().includes(q);

  const routeMatchesQuery = (r: ShuttleRoute) => {
    if (!q) return true;
    if (textMatches(r.route_no) || textMatches(r.name ?? "")) return true;
    const geo = routeGeo.get(r.id);
    if (geo && ([...geo.gus].some(textMatches) || [...geo.dongs].some(textMatches))) return true;
    return (stopsByRoute.get(r.id) ?? []).some((s) => textMatches(s.address ?? ""));
  };

  const guMatchesQuery = (gu: string) => {
    if (!q) return true;
    if (gu.toLowerCase().includes(q)) return true;
    return routes.some((r) => routeGeo.get(r.id)?.gus.has(gu) && routeMatchesQuery(r));
  };

  // 선택한 구 안에서 동별로 묶어, 그 동에 가는 노선(호차) 목록을 보여줍니다.
  const dongBreakdown = useMemo(() => {
    if (!selectedGu) return [];
    const m = new Map<string, Map<string, ShuttleRoute>>();
    for (const r of routes) {
      for (const s of stopsByRoute.get(r.id) ?? []) {
        if (s.gu !== selectedGu) continue;
        const dong = s.dong ?? "(동 미상)";
        const entry = m.get(dong) ?? new Map<string, ShuttleRoute>();
        entry.set(r.id, r);
        m.set(dong, entry);
      }
    }
    return [...m.entries()]
      .map(([dong, routeMap]) => ({ dong, routes: [...routeMap.values()].sort((a, b) => natCompare(a.route_no, b.route_no)) }))
      .sort((a, b) => b.routes.length - a.routes.length || a.dong.localeCompare(b.dong, "ko"));
  }, [selectedGu, routes, stopsByRoute]);

  const fullList = useMemo(() => {
    return [...routes]
      .filter(routeMatchesQuery)
      .sort((a, b) => {
        const ga = routeGeo.get(a.id)?.primaryGu ?? "(미상)";
        const gb = routeGeo.get(b.id)?.primaryGu ?? "(미상)";
        const gc = ga.localeCompare(gb, "ko");
        if (gc !== 0) return gc;
        if (a.direction !== b.direction) return a.direction === "등원" ? -1 : 1;
        return natCompare(a.route_no, b.route_no);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, routeGeo, q]);

  const geocodedStopCount = stops.filter((s) => s.gu).length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="지명·아파트·도로명·차호수로 검색 (예: 청담, 메이플자이, 22)"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {geocodedStopCount < stops.length && (
          <span className="text-[11px] text-amber-600">
            정류장 {stops.length}곳 중 {geocodedStopCount}곳만 구/동 정보가 채워졌습니다 - 셔틀 현황에서 노선도를 한 번씩 열면 채워집니다.
          </span>
        )}
      </div>

      <div className={"flex min-h-0 gap-3 " + (hideList ? "flex-1" : "flex-[3]")}>
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-2">
          <SeoulGuMap counts={guCounts} selected={selectedGu} onSelect={(gu) => setSelectedGu((prev) => (prev === gu ? null : gu))} matches={guMatchesQuery} />
        </div>

        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {!selectedGu ? (
              <p className="py-8 text-center text-xs text-slate-400">지도에서 구를 눌러보세요. 숫자는 그 구로 가는 노선 수입니다.</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-bold text-slate-700">
                  📍 {selectedGu} · 동 {dongBreakdown.length}곳 · 노선 {guCounts[selectedGu] ?? 0}대
                </p>
                <div className="space-y-2">
                  {dongBreakdown.map(({ dong, routes: rs }) => {
                    const going = rs.filter((r) => r.direction === "등원");
                    const returning = rs.filter((r) => r.direction === "하원");
                    const chip = (r: ShuttleRoute) => {
                      const count = riderCountByRoute.get(r.id) ?? 0;
                      const over = r.usable_capacity != null && count > r.usable_capacity;
                      return (
                        <span
                          key={r.id}
                          title={`${r.driver_name ?? "기사님 미정"} · ${count}명${r.usable_capacity != null ? `/${r.usable_capacity}` : ""}`}
                          className={
                            "rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white " +
                            (over ? "bg-red-500" : r.direction === "등원" ? "bg-amber-600" : "bg-indigo-600")
                          }
                        >
                          {r.route_no}호{over && " ⚠️"}
                        </span>
                      );
                    };
                    return (
                      <div key={dong} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px]">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-semibold text-slate-700">{dong}</span>
                          <span className="text-slate-400">{rs.length}대</span>
                        </div>
                        <div className="space-y-1">
                          {going.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="w-8 shrink-0 text-[10px] font-semibold text-amber-700">등원</span>
                              {going.map(chip)}
                            </div>
                          )}
                          {returning.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="w-8 shrink-0 text-[10px] font-semibold text-indigo-700">하원</span>
                              {returning.map(chip)}
                            </div>
                          )}
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

      {!hideList && (
      <div className="min-h-0 flex-[2] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-xs font-bold text-slate-700">전체 노선 - 지역순 · 호차 오름차순 ({fullList.length})</p>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400">
              <th className="py-1 pr-2">구</th>
              <th className="py-1 pr-2">동</th>
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
              const geo = routeGeo.get(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => geo?.primaryGu && setSelectedGu(geo.primaryGu)}
                  className="cursor-pointer border-b border-slate-50 text-slate-600 hover:bg-slate-50"
                >
                  <td className="py-1 pr-2">{geo?.primaryGu ?? "(미상)"}</td>
                  <td className="py-1 pr-2">{geo && geo.dongs.size > 0 ? [...geo.dongs].join(", ") : "-"}</td>
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
                <td colSpan={8} className="py-6 text-center text-slate-400">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
