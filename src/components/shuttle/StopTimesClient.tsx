"use client";

import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";

// 정류장 도착 시간 기록 화면(요청: "각 정류장 도착하는 시간 기록해서 평균을 내줘 (...) 어느
// 정류장에 어느 시간에 정차했고 위치가 어디인지 클릭해서 볼 수 있도록"). 노선별로 정류장 평균
// 도착시각·오늘 도착·관측 일수를 보여주고, 정류장을 누르면 지도 위치와 지난 도착 기록을 봅니다.

type Rec = { date: string; time: string; minutes: number };
type Stop = {
  stopId: string;
  seq: number;
  address: string | null;
  lat: number | null;
  lng: number | null;
  hasGpsLearned: boolean;
  avgTime: string | null;
  count: number;
  todayTime: string | null;
  records: Rec[];
};
type Route = {
  routeId: string;
  routeNo: string;
  name: string | null;
  driverName: string | null;
  stops: Stop[];
  lastStopAvg: string | null;
  lastStopAddress: string | null;
};

export default function StopTimesClient() {
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ route: Route; stop: Stop } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/shuttle/stop-times");
        const json = await res.json();
        if (!res.ok) { setErr(json.error ?? "불러오지 못했습니다."); return; }
        setRoutes(json.routes as Route[]);
      } catch {
        setErr("불러오지 못했습니다.");
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-lg font-bold">⏱️ 정류장 도착 시간</h1>
      <p className="mb-4 text-xs text-slate-500">
        기사님 GPS로 각 정류장에 도착한 시각을 매일 기록해 평균을 냅니다. 정류장을 누르면 위치와 지난 도착 기록을 볼 수 있습니다.
      </p>

      {err && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{err}</p>}
      {!routes && !err && <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>}

      <div className="space-y-4">
        {(routes ?? []).map((r) => (
          <div key={r.routeId} className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm font-bold text-slate-800">{r.routeNo}호</span>
              {r.name && <span className="text-xs text-slate-500">{r.name}</span>}
              {r.driverName && <span className="text-xs text-slate-400">· {r.driverName} 기사님</span>}
              {r.lastStopAvg && (
                <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  마지막 정류장 평균 도착 {r.lastStopAvg}
                </span>
              )}
            </div>
            {r.stops.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400">정류장이 없습니다.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] text-slate-400">
                    <th className="w-10 px-3 py-1.5 font-semibold">순번</th>
                    <th className="px-3 py-1.5 font-semibold">정류장</th>
                    <th className="w-24 px-3 py-1.5 font-semibold">평균 도착</th>
                    <th className="w-20 px-3 py-1.5 font-semibold">오늘</th>
                    <th className="w-16 px-3 py-1.5 font-semibold">관측</th>
                  </tr>
                </thead>
                <tbody>
                  {r.stops.map((s) => (
                    <tr
                      key={s.stopId}
                      onClick={() => setDetail({ route: r, stop: s })}
                      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-blue-50/50"
                    >
                      <td className="px-3 py-2 font-bold text-slate-500">{s.seq + 1}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {s.address ?? "(주소 없음)"}
                        {!s.hasGpsLearned && <span className="ml-1 text-[10px] text-slate-300">· GPS 학습 전</span>}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-800">{s.avgTime ?? "—"}</td>
                      <td className="px-3 py-2 text-blue-600">{s.todayTime ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400">{s.count > 0 ? `${s.count}회` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {detail && <StopDetail route={detail.route} stop={detail.stop} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StopDetail({ route, stop, onClose }: { route: Route; stop: Stop; onClose: () => void }) {
  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (stop.lat == null || stop.lng == null) return;
    let cancelled = false;
    (async () => {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !divRef.current) return;
        const center = new kakao.maps.LatLng(stop.lat as number, stop.lng as number);
        mapRef.current = new kakao.maps.Map(divRef.current, { center, level: 3 });
        const marker = new kakao.maps.CustomOverlay({
          position: center,
          content: `<div style="background:#2563eb;color:#fff;font-size:12px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)">${stop.seq + 1}번 정류장</div>`,
          yAnchor: 1.4,
        });
        marker.setMap(mapRef.current);
      } catch {
        if (!cancelled) setMapError("지도를 불러오지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [stop]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold text-slate-800">{route.routeNo}호 · {stop.seq + 1}번 정류장</span>
          {stop.avgTime && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">평균 {stop.avgTime}</span>}
          <button onClick={onClose} className="ml-auto text-slate-400">✕</button>
        </div>
        <p className="mb-2 text-xs text-slate-500">{stop.address ?? "(주소 없음)"}</p>

        {stop.lat != null && stop.lng != null ? (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div ref={divRef} style={{ width: "100%", height: 220, background: "#eef2f7" }} />
            {mapError && <p className="px-3 py-2 text-xs text-slate-400">{mapError}</p>}
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
            아직 위치 좌표가 없습니다. 며칠 운행하면 GPS로 좌표가 학습됩니다.
          </p>
        )}

        <div className="mt-3">
          <p className="mb-1 text-xs font-bold text-slate-600">지난 도착 기록</p>
          {stop.records.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">아직 도착 기록이 없습니다.</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {stop.records.map((rec, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-[11px]">
                  <span className="text-slate-500">{rec.date}</span>
                  <span className="font-mono font-bold text-slate-700">{rec.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
