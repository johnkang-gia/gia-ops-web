"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// 결석·픽업 이력 화면.
//
// 보여주는 것은 **숫자와 그 숫자가 나온 바탕**입니다. "3번 빠짐"만 적으면 20일 중 3번인지
// 5일 중 3번인지 알 수 없어서, 전체 기록 수를 함께 둡니다.
//
// 여기서 아무것도 고치지 않습니다. 조회 전용입니다 - 지난 기록을 화면에서 손댈 수 있게
// 만들면 "언제 누가 왜 바꿨나"를 다시 쫓게 됩니다.

export type HistoryRow = {
  key: string;
  name: string;
  grade: string | null;
  className: string | null;
  routes: string[];
  /** 기간 안에 이 학생에게 찍힌 하원 기록 수(픽업·결석·탑승 등 전부). */
  total: number;
  pickup: number;
  absent: number;
  boarded: number;
  lastPickup: string | null;
  lastAbsent: string | null;
};

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

export default function ShuttleHistoryClient({
  rows,
  from,
  to,
  clamped,
  maxDays,
  loadError,
}: {
  rows: HistoryRow[];
  from: string;
  to: string;
  clamped: boolean;
  maxDays: number;
  loadError: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"total" | "absent" | "pickup" | "name">("total");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.className ?? "").toLowerCase().includes(q) ||
          r.routes.some((n) => n.includes(q))
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name, "ko");
      if (sortBy === "absent") return b.absent - a.absent || a.name.localeCompare(b.name, "ko");
      if (sortBy === "pickup") return b.pickup - a.pickup || a.name.localeCompare(b.name, "ko");
      return b.absent + b.pickup - (a.absent + a.pickup) || a.name.localeCompare(b.name, "ko");
    });
  }, [rows, query, sortBy]);

  const sumPickup = rows.reduce((s, r) => s + r.pickup, 0);
  const sumAbsent = rows.reduce((s, r) => s + r.absent, 0);

  function apply(nextFrom: string, nextTo: string) {
    router.push(`/shuttle/history?from=${nextFrom}&to=${nextTo}`);
  }

  function quick(days: number) {
    const t = new Date();
    const toStr = t.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const fromStr = new Date(Date.now() - days * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    apply(fromStr, toStr);
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-bold text-slate-800">📆 결석 · 픽업 이력</h1>
        <span className="text-xs text-slate-500">
          {from} ~ {to} · 픽업 {sumPickup}회 · 결석 {sumAbsent}회 · 학생 {rows.length}명
        </span>
      </div>
      <p className="mb-3 text-[11px] text-slate-400">
        하원 체크표에 찍힌 기록을 기간으로 묶어 보여줍니다. 여기서는 고칠 수 없고, 보기만 합니다.
      </p>

      {clamped && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          기간이 너무 길어 최근 {maxDays}일로 줄였습니다. 더 긴 기간이 필요하면 나눠서 보세요.
        </p>
      )}
      {loadError && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          기록을 읽지 못했습니다: {loadError}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button onClick={() => quick(7)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">
          최근 7일
        </button>
        <button onClick={() => quick(30)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">
          최근 30일
        </button>
        <button onClick={() => quick(90)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">
          최근 90일
        </button>
        <input
          type="date"
          defaultValue={from}
          onChange={(e) => e.target.value && apply(e.target.value, to)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        />
        <span className="text-xs text-slate-400">~</span>
        <input
          type="date"
          defaultValue={to}
          onChange={(e) => e.target.value && apply(from, e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 · 반 · 호차"
          className="ml-auto w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs"
        />
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          이 기간에 픽업·결석 기록이 없습니다.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-semibold">
                  <button onClick={() => setSortBy("name")} className={sortBy === "name" ? "text-blue-700 underline" : ""}>
                    학생
                  </button>
                </th>
                <th className="px-2 py-1.5 font-semibold">반</th>
                <th className="px-2 py-1.5 font-semibold">호차</th>
                <th className="px-2 py-1.5 text-center font-semibold">
                  <button onClick={() => setSortBy("pickup")} className={sortBy === "pickup" ? "text-blue-700 underline" : ""}>
                    픽업
                  </button>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold">
                  <button onClick={() => setSortBy("absent")} className={sortBy === "absent" ? "text-blue-700 underline" : ""}>
                    결석
                  </button>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold">기록 수</th>
                <th className="px-2 py-1.5 font-semibold">마지막</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-semibold text-slate-800">{r.name}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.className ?? r.grade ?? "-"}</td>
                  <td className="px-2 py-1.5 text-slate-500">{[...r.routes].sort(natCompare).join("·") || "-"}</td>
                  <td className="px-2 py-1.5 text-center">
                    {r.pickup > 0 ? <b className="text-blue-700">{r.pickup}</b> : <span className="text-slate-300">0</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {r.absent > 0 ? <b className="text-red-600">{r.absent}</b> : <span className="text-slate-300">0</span>}
                  </td>
                  {/* "3번 빠짐"은 20일 중 3번과 5일 중 3번이 전혀 다른 이야기입니다. */}
                  <td className="px-2 py-1.5 text-center text-slate-400">{r.total}</td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-400">
                    {r.lastAbsent && <>결석 {r.lastAbsent.slice(5)}</>}
                    {r.lastAbsent && r.lastPickup && " · "}
                    {r.lastPickup && <>픽업 {r.lastPickup.slice(5)}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
