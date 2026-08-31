"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShuttleRoute, ShuttleStop, ShuttleAssignment } from "@/lib/types";
import ShuttleRegionDashboard from "./ShuttleRegionDashboard";
import BusFront from "./BusFront";

// 셔틀 "개요 대시보드"(요청: 메뉴 여러 개를 개요+탭으로 통합, 여백을 시각화로 채우고 매일
// 확인할 것들을 한 화면에서). 숫자 카운트업·도넛·펄스·hover 리프트 등 은은한 모션으로
// "AI 티" 없이 정돈된 관리자 대시보드 느낌을 냅니다(레퍼런스: Ant/Carbon).
export type RouteStat = {
  routeNo: string;
  name: string | null;
  gu: string | null;
  dong: string | null;
  driver: string | null;
  vehicleNo: string | null;
  color: string;
  today: number;
  capacity: number | null;
  over: boolean;
  lastStopAvg: string | null;
  todayLast: string | null;
  delayMin: number | null;
  skipStops: number;
  adjustedLast: string | null;
  gps: "live" | "idle" | "none";
};
export type OverviewKpi = {
  expected: number;
  pickup: number;
  absent: number;
  boarded: number;
  running: number;
  totalDevices: number;
  notes: number;
  lastStopAvg: string | null;
  pendingPickups: number;
  unsetDevices: number;
  overCount: number;
};

function useCountUp(target: number, ms = 650) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  const n = useCountUp(value);
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-3xl font-extrabold tabular-nums" style={{ color: tone }}>
        {n}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export type OverviewNote = { studentName: string; routeNo: string | null; content: string; effLabel: string };

export default function ShuttleOverviewClient({
  date,
  kpi,
  routes,
  pickupNames = [],
  absentNames = [],
  notes = [],
  regionRoutes = [],
  regionStops = [],
  regionAssignments = [],
}: {
  date: string;
  kpi: OverviewKpi;
  routes: RouteStat[];
  pickupNames?: string[];
  absentNames?: string[];
  notes?: OverviewNote[];
  regionRoutes?: ShuttleRoute[];
  regionStops?: ShuttleStop[];
  regionAssignments?: Pick<ShuttleAssignment, "stop_id">[];
}) {
  const router = useRouter();
  const donutRef = useRef<HTMLDivElement | null>(null);
  const total = Math.max(1, kpi.expected + kpi.pickup + kpi.absent);
  const p1 = (kpi.expected / total) * 100;
  const p2 = p1 + (kpi.pickup / total) * 100;
  const expectedNum = useCountUp(kpi.expected);

  // 도넛을 0%에서 목표 비율까지 부드럽게 채웁니다.
  useEffect(() => {
    const el = donutRef.current;
    if (!el) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      const e = 1 - Math.pow(1 - p, 3);
      el.style.background = `conic-gradient(#2563eb 0 ${p1 * e}%, #f59e0b ${p1 * e}% ${p2 * e}%, #ef4444 ${p2 * e}% ${100 * e}%, #eef2f7 ${100 * e}% 100%)`;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p1, p2]);

  const gpsColor = (g: RouteStat["gps"]) => (g === "live" ? "#16a34a" : g === "idle" ? "#f59e0b" : "#cbd5e1");

  return (
    <div className="w-full">
      <style>{`
        @keyframes gpspulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:.35} }
        @keyframes rise { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .ov-rise{animation:rise .4s ease both}
      `}</style>

      <div className="mb-3 text-right text-xs text-slate-400">정규학기 · {date}</div>

      {/* 실시간·지역 지도(요청: 맨 위에는 지도만 크게. 구를 누르면 그 지역 노선이 옆에 뜸.
          전체 노선 목록은 아래 통합 표로 관리하므로 지도 아래 리스트는 감춥니다). */}
      {regionRoutes.length > 0 && (
        <div className="ov-rise mb-3 h-[600px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3">
          <ShuttleRegionDashboard routes={regionRoutes} stops={regionStops} assignments={regionAssignments} hideList />
        </div>
      )}

      {/* KPI row: 도넛 + 카드 */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="ov-rise flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-3">
          <div ref={donutRef} className="flex h-24 w-24 items-center justify-center rounded-full" style={{ background: "#eef2f7" }}>
            <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white">
              <b className="text-xl tabular-nums">{expectedNum}</b>
              <span className="text-[10px] text-slate-400">탑승예정</span>
            </div>
          </div>
          <div className="mt-2 flex gap-2 text-[10px]">
            <span className="text-blue-600">●탑승</span>
            <span className="text-amber-500">●픽업</span>
            <span className="text-red-500">●결석</span>
          </div>
        </div>
        <Kpi label="운행 중" value={kpi.running} tone="#16a34a" sub={`전체 ${kpi.totalDevices}대`} />
        <Kpi label="픽업(직접하원)" value={kpi.pickup} tone="#d97706" sub="토들·전화·교사" />
        <Kpi label="결석" value={kpi.absent} tone="#dc2626" sub="오늘 반영" />
        <Kpi label="지속 특이사항" value={kpi.notes} tone="#0f172a" sub="셔틀 자동 반영" />
        <Kpi label="탑승 완료" value={kpi.boarded} tone="#2563eb" sub="현재까지" />
      </div>

      {/* 본문: 노선 그리드 + 사이드 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
        <div className="ov-rise rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <b className="text-sm">노선별 현황</b>
            {/* 그림 하나에 두 가지가 들어 있으니 무엇이 무엇인지 적어둡니다.
                범례 없는 그림은 예쁘기만 하고 안 읽힙니다. */}
            <span className="text-[11px] text-slate-400">진한 차 = 오늘 탑승 · 📶 초록 = GPS 연결</span>
          </div>
          {/* 담당자 요청 ⑦: 네모 대신 버스 앞모습.
              색칠한 네모 스무 개는 눈으로 훑을 때 다 같아 보입니다. 버스 모양이면 진한 차와
              흐린 차의 차이가 글자를 읽기 전에 먼저 들어옵니다. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
            {routes.map((r) => (
              <button
                key={r.routeNo}
                type="button"
                onClick={() => router.push("/shuttle/regions")}
                title={
                  `${r.routeNo}호${r.driver ? " · " + r.driver : ""}` +
                  ` · 오늘 ${r.today}명${r.capacity != null ? `/${r.capacity}` : ""}` +
                  ` · ${r.gps === "live" ? "GPS 연결됨" : r.gps === "idle" ? "GPS 신호 끊김" : "GPS 미연결"}`
                }
                className={
                  "flex flex-col items-center rounded-xl p-1.5 transition-all hover:-translate-y-0.5 hover:bg-slate-50 " +
                  (r.today > 0 ? "" : "hover:opacity-100")
                }
              >
                <div className="h-12 w-full">
                  <BusFront routeNo={r.routeNo} color={r.color} riders={r.today} gps={r.gps} />
                </div>
                <div
                  className={
                    "mt-0.5 text-[11px] leading-tight " +
                    (r.over ? "font-bold text-red-600" : r.today > 0 ? "text-slate-600" : "text-slate-300")
                  }
                >
                  🧒 {r.today}
                  {r.capacity != null && <span className="opacity-60">/{r.capacity}</span>}
                  {r.over && " ⚠"}
                </div>
                {r.today > 0 && (r.lastStopAvg || r.delayMin != null) && (
                  <div className="text-[10px] leading-tight text-slate-400">
                    {r.lastStopAvg ?? "-"}
                    {r.delayMin != null && r.delayMin !== 0 && (
                      <span className={r.delayMin > 0 ? "text-red-500" : "text-emerald-600"}>
                        {" "}
                        {r.delayMin > 0 ? `+${r.delayMin}` : r.delayMin}
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="ov-rise rounded-2xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                📥 픽업 인박스 <b>{kpi.pendingPickups}</b>
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                ⏱️ 막차 평균 <b>{kpi.lastStopAvg ?? "-"}</b>
              </span>
              <span
                className={
                  "rounded-full border px-2.5 py-1 " +
                  (kpi.overCount ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50")
                }
              >
                🚸 정원 초과 <b>{kpi.overCount}</b>
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                🔗 미설치 기기 <b>{kpi.unsetDevices}</b>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 오늘 픽업·결석 명단 + 지속 특이사항(요청: 숫자만 말고 실제 정보를 자세히). */}
      <div className="ov-rise mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-3 text-xs font-bold">
            <span className="text-amber-600">🚗 오늘 픽업 {pickupNames.length}</span>
            <span className="text-red-500">🚫 결석 {absentNames.length}</span>
          </div>
          {pickupNames.length + absentNames.length === 0 ? (
            <p className="text-xs text-slate-400">오늘 픽업·결석으로 들어온 학생이 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {pickupNames.map((n, i) => (
                <span key={"p" + i} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  {n}
                </span>
              ))}
              {absentNames.map((n, i) => (
                <span key={"a" + i} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 line-through">
                  {n}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-orange-200 bg-orange-50/40 p-4">
          <div className="mb-2 text-xs font-bold text-orange-700">📌 지속 특이사항 {notes.length}건 (셔틀 자동 반영)</div>
          {notes.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 지속 특이사항이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {notes.map((n, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[12px]">
                  <span className="font-bold text-orange-900">
                    {n.studentName}
                    {n.routeNo ? `(${n.routeNo})` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-orange-800">· {n.content}</span>
                  <span className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">{n.effLabel}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 노선 상세 요약(요청 ⑨: 전체노선 하단 여백을 정보로 채움). 기사·차량·정원 대비 인원·
          막차 평균·오늘 지연·GPS를 한 표로. */}
      <div className="ov-rise mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-3 py-2 font-semibold">호차</th>
              <th className="px-3 py-2 font-semibold">지역</th>
              <th className="px-3 py-2 font-semibold">기사·차량</th>
              <th className="px-3 py-2 text-center font-semibold">오늘/정원</th>
              <th className="px-3 py-2 text-center font-semibold">막차 평균</th>
              <th className="px-3 py-2 text-center font-semibold">오늘 건너뜀</th>
              <th className="px-3 py-2 text-center font-semibold">오늘 지연</th>
              <th className="px-3 py-2 text-center font-semibold">GPS</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.routeNo} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-1.5 font-bold" style={{ color: r.color }}>
                  {r.routeNo}호
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-600">
                  {r.gu || r.dong ? (
                    <>
                      {r.gu && <span className="font-semibold text-slate-700">{r.gu}</span>}
                      {r.dong && <span className="text-slate-400"> · {r.dong}</span>}
                      {r.name && <div className="text-[10px] text-slate-400">{r.name}</div>}
                    </>
                  ) : (
                    r.name ?? "-"
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500">
                  {r.driver ?? "-"}
                  {r.vehicleNo ? ` · ${r.vehicleNo}` : ""}
                </td>
                <td className={"px-3 py-1.5 text-center " + (r.over ? "font-bold text-red-600" : "text-slate-700")}>
                  {r.today}
                  {r.capacity != null ? `/${r.capacity}` : ""}
                  {r.over && " ⚠"}
                </td>
                <td className="px-3 py-1.5 text-center text-slate-600">
                  {r.lastStopAvg ?? "-"}
                  {r.adjustedLast && <span className="ml-1 text-[11px] font-semibold text-emerald-600">→ {r.adjustedLast}</span>}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {r.skipStops > 0 ? (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">{r.skipStops}곳</span>
                  ) : (
                    <span className="text-slate-300">-</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {r.delayMin == null ? (
                    <span className="text-slate-300">-</span>
                  ) : r.delayMin > 0 ? (
                    <span className="text-red-500">+{r.delayMin}분</span>
                  ) : r.delayMin < 0 ? (
                    <span className="text-emerald-600">{r.delayMin}분</span>
                  ) : (
                    <span className="text-slate-400">정시</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-center">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: gpsColor(r.gps) }}
                    title={r.gps === "live" ? "연결 중" : r.gps === "idle" ? "신호 없음" : "기기 없음"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
