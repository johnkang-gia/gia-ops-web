"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// 정원 대비 탑승률 화면.
//
// 두 숫자를 나란히 둡니다. 섞으면 잘못된 결론이 납니다.
//   · 배정 / 정원  — 계획. 몇 명을 태우기로 했는가.
//   · 평균 탑승 / 정원 — 현실. 픽업·결석을 빼고 진짜 몇 명이 탔는가.
//
// 계획이 꽉 찼는데 현실이 절반이면 차를 줄일 게 아니라 **왜 안 타는지**를 봐야 합니다.
// 둘 다 낮을 때가 노선을 합칠 때입니다. 화면이 그 판단을 대신하지 않고, 두 숫자를
// 나란히 보여주기만 합니다.

export type CapacityRow = {
  id: string;
  routeNo: string;
  name: string | null;
  direction: string;
  term: string;
  driver: string | null;
  /** 실제 태울 수 있는 인원(usable 우선, 없으면 정원). 둘 다 없으면 null. */
  capacity: number | null;
  seatCapacity: number | null;
  planned: number;
  avgRide: number;
  peak: number;
  /** 기간 안에 기록이 있던 날 수. 평균의 바탕입니다. */
  days: number;
};

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

function Bar({ value, max, tone }: { value: number; max: number; tone: "plan" | "real" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  // 100%를 넘으면 빨강. 정원을 넘겨 태우는 것은 안전 문제입니다.
  const over = max > 0 && value > max;
  const color = over ? "bg-red-500" : tone === "plan" ? "bg-slate-400" : "bg-blue-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100">
        <div className={"h-full " + color} style={{ width: `${pct}%` }} />
      </div>
      <span className={"shrink-0 text-[11px] " + (over ? "font-bold text-red-600" : "text-slate-500")}>
        {max > 0 ? `${pct}%` : "-"}
      </span>
    </div>
  );
}

export default function ShuttleCapacityClient({
  rows,
  from,
  to,
  clamped,
  maxDays,
  loadError,
}: {
  rows: CapacityRow[];
  from: string;
  to: string;
  clamped: boolean;
  maxDays: number;
  loadError: string | null;
}) {
  const router = useRouter();
  const [dir, setDir] = useState<"하원" | "등원">("하원");

  const shown = useMemo(
    () => rows.filter((r) => r.direction === dir).sort((a, b) => natCompare(a.routeNo, b.routeNo)),
    [rows, dir]
  );

  const noCapacity = shown.filter((r) => !r.capacity).length;
  const totalCap = shown.reduce((s, r) => s + (r.capacity ?? 0), 0);
  const totalPlanned = shown.reduce((s, r) => s + r.planned, 0);
  const totalAvg = Math.round(shown.reduce((s, r) => s + r.avgRide, 0) * 10) / 10;

  function quick(days: number) {
    const toStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const fromStr = new Date(Date.now() - days * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    router.push(`/shuttle/capacity?from=${fromStr}&to=${toStr}`);
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-bold text-slate-800">🪑 정원 대비 탑승률</h1>
        <span className="text-xs text-slate-500">
          {from} ~ {to} · {dir} {shown.length}대 · 정원 {totalCap}석 · 배정 {totalPlanned}명 · 평균 탑승 {totalAvg}명
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
        <b>배정</b>은 계획(명부상 태우기로 한 인원), <b>평균 탑승</b>은 현실(픽업·결석 빼고 실제 탄 인원)입니다.
        계획은 꽉 찼는데 현실이 절반이면 차를 줄일 게 아니라 <b>왜 안 타는지</b>를 봐야 합니다. 둘 다 낮을 때가
        노선을 합칠 때입니다.
      </p>

      {clamped && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          기간이 너무 길어 최근 {maxDays}일로 줄였습니다.
        </p>
      )}
      {loadError && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          기록을 읽지 못했습니다: {loadError}
        </p>
      )}
      {noCapacity > 0 && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          정원이 안 적힌 차가 {noCapacity}대 있습니다. 그 줄은 비율을 낼 수 없어 인원만 나옵니다 —
          노선 관리에서 채워주세요.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["하원", "등원"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDir(d)}
            className={
              "rounded-lg px-2.5 py-1 text-xs font-bold " +
              (dir === d ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")
            }
          >
            {d}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button onClick={() => quick(7)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">
          최근 7일
        </button>
        <button onClick={() => quick(30)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">
          최근 30일
        </button>
        <button onClick={() => quick(90)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">
          최근 90일
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">{dir} 노선이 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-semibold">호차</th>
                <th className="px-2 py-1.5 font-semibold">정원</th>
                <th className="px-2 py-1.5 font-semibold">배정 (계획)</th>
                <th className="px-2 py-1.5 font-semibold">평균 탑승 (현실)</th>
                <th className="px-2 py-1.5 text-center font-semibold">최다</th>
                <th className="px-2 py-1.5 text-center font-semibold">운행일</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <span className="font-bold text-slate-800">{r.routeNo}호</span>
                    {r.driver && <span className="ml-1 text-[11px] text-slate-400">{r.driver}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">
                    {r.capacity ?? "-"}
                    {/* 실제 탑승 가능 인원이 정원보다 적으면 둘 다 보여줍니다. */}
                    {r.capacity != null && r.seatCapacity != null && r.capacity !== r.seatCapacity && (
                      <span className="ml-1 text-[10px] text-slate-400">({r.seatCapacity}인승)</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-right font-semibold text-slate-700">{r.planned}</span>
                      <Bar value={r.planned} max={r.capacity ?? 0} tone="plan" />
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-right font-semibold text-blue-700">{r.avgRide}</span>
                      <Bar value={r.avgRide} max={r.capacity ?? 0} tone="real" />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-500">{r.peak || "-"}</td>
                  {/* 평균의 바탕. 이틀 기록으로 낸 평균과 20일 기록으로 낸 평균은 무게가 다릅니다. */}
                  <td className="px-2 py-1.5 text-center text-slate-400">{r.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-[11px] text-slate-400">
        평균은 <b>기록이 있는 날</b>로만 나눕니다. 운행 안 한 날까지 나누면 실제보다 낮게 나옵니다.
        운행일이 적으면 그 평균은 아직 믿을 만하지 않습니다.
      </p>
    </div>
  );
}
