"use client";

import { useCallback, useEffect, useState } from "react";
import type { GpsRouteStatus } from "@/app/api/shuttle/gps-status/route";

// 운행 중에 보는 GPS 상태판입니다.
//
// 담당자: "링크·기기에 있는 GPS 연결차 보고 있는데, 따로 탭을 만들어서 쭉 볼 수 있게."
//
// 링크·기기는 "기기를 발급하고 설정 링크를 보내는" 곳이라 한 호차씩 카드로 봅니다. 운행
// 중에 필요한 것은 그게 아니라 **전 호차를 한 줄씩 늘어놓은 판**입니다 - 어느 차가 살아
// 있고, 마지막 신호가 언제고, 정류장이 찍히고 있는지.

const POLL_MS = 10000;

type Payload = { rows: GpsRouteStatus[]; today: string; inWindow: boolean; windowLabel: string };

function ago(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

function gapLabel(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

export default function GpsStatusClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 기기가 없는 호차까지 다 보면 35줄이 넘어 정작 볼 것이 묻힙니다. 기본은 '기기 있는 것만'.
  const [onlyWithDevice, setOnlyWithDevice] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shuttle/gps-status", { cache: "no-store" });
      if (!res.ok) {
        setError("불러오지 못했습니다.");
        return;
      }
      setError(null);
      setData((await res.json()) as Payload);
    } catch {
      setError("연결에 실패했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const rows = (data?.rows ?? []).filter((r) => !onlyWithDevice || r.deviceId);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] font-bold " +
            (data?.inWindow ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")
          }
        >
          {data?.inWindow ? "🟢 지금 추적 시간대" : `⚪ 추적 시간 아님 (${data?.windowLabel ?? "15:30~18:30"})`}
        </span>
        <span className="text-[11px] text-slate-400">10초마다 자동 갱신 · {rows.length}대</span>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={onlyWithDevice} onChange={(e) => setOnlyWithDevice(e.target.checked)} />
          기기 발급된 호차만
        </label>
      </div>

      {error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-600">{error}</p>}

      {/* 추적 시간 밖에는 모든 줄이 비어 있는 게 정상입니다. 그걸 말해주지 않으면
          "왜 다 죽었지?" 하고 기기를 뒤지게 됩니다. */}
      {data && !data.inWindow && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
          지금은 추적 시간대가 아니라 위치가 저장되지 않습니다({data.windowLabel}). 아래 숫자가 0인 것은 정상입니다.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto g-panel-solid">
        <table className="w-full min-w-[880px] border-collapse text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="w-16 px-2 py-1.5">호차</th>
              <th className="w-28 px-2 py-1.5">지역</th>
              <th className="w-20 px-2 py-1.5">기사님</th>
              <th className="w-24 px-2 py-1.5">마지막 신호</th>
              <th className="w-20 px-2 py-1.5">오늘 위치</th>
              <th className="w-24 px-2 py-1.5">가장 긴 끊김</th>
              <th className="w-24 px-2 py-1.5">오늘 정류장</th>
              <th className="w-36 px-2 py-1.5">정류장 좌표</th>
              <th className="px-2 py-1.5">마지막 처리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // 살아 있음 = 5분 안에 신호. 운행 시간대가 아니면 판단하지 않습니다.
              const alive = r.lastPingSec != null && r.lastPingSec < 300;
              const gapBad = r.maxGapSec != null && r.maxGapSec > 300;
              return (
                <tr key={r.routeId} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-1.5 font-bold text-slate-700">
                    <span className={"mr-1 " + (alive ? "text-emerald-500" : "text-slate-300")}>●</span>
                    {r.routeNo}호
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">{r.name ?? ""}</td>
                  <td className="px-2 py-1.5 text-slate-400">{r.driverName ?? "—"}</td>
                  <td className={"px-2 py-1.5 " + (alive ? "font-semibold text-emerald-700" : "text-slate-400")}>
                    {ago(r.lastPingSec)}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{r.pingsToday}건</td>
                  <td className={"px-2 py-1.5 " + (gapBad ? "font-bold text-red-600" : "text-slate-400")}>
                    {gapLabel(r.maxGapSec)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={r.arrivedToday > 0 ? "font-bold text-blue-600" : "text-slate-300"}>
                      {r.arrivedToday}/{r.stopCount}
                    </span>
                  </td>
                  {/* 학습이 얼마나 진행됐는지. 이 칸이 초록으로 차오르면 반경이 80m로 좁혀집니다. */}
                  <td className="px-2 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {r.stopsLearned > 0 && (
                        <span className="rounded bg-emerald-50 px-1 font-semibold text-emerald-700" title="여러 날 확인됨 · 반경 80m">
                          학습 {r.stopsLearned}
                        </span>
                      )}
                      {r.stopsGeocoded > 0 && (
                        <span className="rounded bg-amber-50 px-1 font-semibold text-amber-700" title="주소 좌표만 있음 · 반경 500m">
                          주소 {r.stopsGeocoded}
                        </span>
                      )}
                      {r.stopsNoCoords > 0 && (
                        <span className="rounded bg-red-50 px-1 font-semibold text-red-600" title="좌표 없음 · 도착을 찍을 수 없습니다">
                          없음 {r.stopsNoCoords}
                        </span>
                      )}
                      {r.stopCount === 0 && <span className="text-slate-300">정류장 없음</span>}
                    </span>
                  </td>
                  {/* 서버가 마지막 요청을 어떻게 처리했는지 그대로. "정류장 도착(주소 190m)" /
                      "228m 지나가는 중(34km/h)" / "가장 가까운 정류장 1400m" 등. */}
                  <td className="px-2 py-1.5 text-slate-500">
                    {r.lastHitReason ?? (r.deviceId ? "아직 신호 없음" : "기기 미발급")}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-8 text-center text-slate-400">
                  {onlyWithDevice ? "기기가 발급된 호차가 없습니다." : "노선이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
