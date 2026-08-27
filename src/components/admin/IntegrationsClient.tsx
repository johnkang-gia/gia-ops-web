"use client";

import { useEffect, useState } from "react";

export type Row = {
  key: string;
  label: string;
  what: string;
  everyMinutes: number;
  officeHoursOnly: boolean;
  lastSeenAt: string | null;
  status: string | null;
  detail: string | null;
};

export type DataStat = { label: string; value: string; sub: string; warn: boolean };

function ago(iso: string | null): string {
  if (!iso) return "신호 없음";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

// 평일 07~19시(한국)인지. 이 시간대에만 도는 크론은 밤중에 조용해도 정상입니다.
function inOfficeHours(): boolean {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const day = kst.getDay();
  const h = kst.getHours();
  return day >= 1 && day <= 5 && h >= 7 && h < 19;
}

// 🟢 정상 / 🟡 늦음 / 🔴 끊김 / ⚪ 지금은 안 도는 시간대
//
// 기준: 정해진 간격의 3배가 지나면 끊긴 것으로 봅니다. 네트워크가 한두 번 튄 것까지
// 빨간불을 켜면 아무도 안 믿게 됩니다 - 경보는 드물게 울려야 값어치가 있습니다.
function judge(r: Row): { dot: string; text: string; tone: string } {
  if (r.officeHoursOnly && !inOfficeHours()) {
    return { dot: "⚪", text: "지금은 쉬는 시간대", tone: "text-slate-400" };
  }
  if (!r.lastSeenAt) return { dot: "🔴", text: "한 번도 안 돌았습니다", tone: "text-red-600 font-bold" };
  const late = Date.now() - new Date(r.lastSeenAt).getTime() > r.everyMinutes * 60 * 1000 * 3;
  if (late) return { dot: "🔴", text: "끊김", tone: "text-red-600 font-bold" };
  if (r.status && r.status !== "ok") return { dot: "🟡", text: r.status, tone: "text-amber-600 font-semibold" };
  return { dot: "🟢", text: "정상", tone: "text-emerald-600" };
}

function everyLabel(m: number): string {
  if (m < 60) return `${m}분마다`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간마다`;
  if (m < 60 * 24 * 7) return "하루 한 번";
  return "주 한 번";
}

export default function IntegrationsClient({ rows, stats }: { rows: Row[]; stats: DataStat[] }) {
  // 1분마다 다시 그립니다 - "3분 전"이 화면에 박혀 있으면 보는 사람이 언제 기준인지 모릅니다.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const broken = rows.filter((r) => judge(r).dot === "🔴");

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-lg font-bold">🔌 연동 상태</h1>
      <p className="mb-4 text-xs text-slate-500">
        이 앱은 크론·수집기·GPS에 기대어 굴러갑니다. 이것들이 멈춰도 화면은 멀쩡해 보이고 데이터만 안 들어옵니다.
        여기서 무엇이 돌고 있는지 확인하세요.
      </p>

      {broken.length > 0 ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-bold text-red-700">🔴 멈춘 것이 {broken.length}개 있습니다</p>
          <p className="mt-1 text-xs text-red-600">{broken.map((b) => b.label).join(" · ")}</p>
          <p className="mt-1.5 text-[11px] text-red-500">
            크론이라면 cron-job.org에 등록되어 있는지, 주소와 Authorization 헤더가 맞는지 확인해주세요.
          </p>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-bold text-emerald-700">🟢 모두 정상입니다</p>
        </div>
      )}

      {/* 실제로 쌓인 데이터 - 신호만으로는 "돌긴 도는데 아무것도 안 들어오는" 상태를 못 잡습니다. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className={"rounded-xl border p-3 " + (s.warn ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white")}>
            <p className="text-[11px] text-slate-400">{s.label}</p>
            <p className={"text-sm font-bold " + (s.warn ? "text-amber-700" : "text-slate-800")}>{s.value}</p>
            {s.sub && <p className="mt-0.5 text-[11px] text-slate-500">{s.sub}</p>}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] text-slate-400">
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 font-semibold">연동</th>
              <th className="w-28 px-3 py-2 font-semibold">주기</th>
              <th className="w-32 px-3 py-2 font-semibold">마지막 신호</th>
              <th className="w-32 px-3 py-2 font-semibold">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const j = judge(r);
              return (
                <tr key={r.key} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 text-center">{j.dot}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-slate-800">{r.label}</span>
                    {r.what && <p className="text-[11px] text-slate-400">{r.what}</p>}
                    {r.detail && <p className="text-[11px] text-amber-600">{r.detail}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{everyLabel(r.everyMinutes)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600" title={r.lastSeenAt ?? undefined}>
                    {ago(r.lastSeenAt)}
                  </td>
                  <td className={"px-3 py-2 text-xs " + j.tone}>{j.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        · 신호는 각 크론이 실제로 실행될 때 남깁니다. 등록만 하고 안 불리면 여기 안 뜹니다.
        <br />· 정해진 주기의 3배가 지나면 끊긴 것으로 봅니다. 경보가 자주 울리면 아무도 안 보게 되므로 여유를 뒀습니다.
        <br />· 방금 배포했다면 각 크론이 한 번씩 돌 때까지는 🔴로 보입니다.
      </p>
    </div>
  );
}
