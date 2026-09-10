"use client";

import { useState } from "react";
import Link from "next/link";
import { BATCH, SCREENS, allTargets, type CheckResult, type Verdict } from "@/lib/siteCheck";

/**
 * **사이트 점검** — 눌러 한 바퀴 돌고 결과를 보여줍니다.
 *
 * ── 왜 나눠 부르나 ──────────────────────────────────────────────────
 *
 * 화면이 90개가 넘어서 한 번에 부르면 창구가 시간을 넘겨 **통째로 실패**합니다. 그러면
 * 어디까지 멀쩡했는지도 모릅니다. 여덟 개씩 나눠 부르면 진행 상황이 눈에 보이고, 중간에
 * 한 묶음이 실패해도 그 묶음만 「점검 못 함」으로 남습니다.
 *
 * ── 실패한 묶음을 조용히 버리지 않습니다 ────────────────────────────
 *
 * 묶음 하나가 실패했는데 그냥 건너뛰면 그 화면들은 결과에서 사라지고, 사람 눈에는 「전부
 * 정상」으로 보입니다. 못 본 것은 못 봤다고 적습니다.
 */

const COLOR: Record<Verdict, string> = {
  정상: "text-emerald-700 bg-emerald-50 border-emerald-200",
  느림: "text-amber-800 bg-amber-50 border-amber-300",
  오류: "text-red-700 bg-red-50 border-red-300",
  "안 열림": "text-red-700 bg-red-50 border-red-300",
  "없는 화면": "text-red-700 bg-red-50 border-red-300",
  "로그인으로 튕김": "text-orange-800 bg-orange-50 border-orange-300",
  "권한 막힘": "text-orange-800 bg-orange-50 border-orange-300",
};
/** 가운뎃값. 평균은 느린 화면 하나에 통째로 끌려가서 「보통 얼마나 걸리나」를 못 보여줍니다. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/** 위험한 순서. 사람이 위에서부터 읽고 손대면 됩니다. */
const ORDER: Verdict[] = ["오류", "안 열림", "없는 화면", "로그인으로 튕김", "권한 막힘", "느림", "정상"];

export default function SiteCheckPanel() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [missed, setMissed] = useState<{ paths: string[]; why: string }[]>([]);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [onlyBad, setOnlyBad] = useState(true);

  async function run() {
    const targets = allTargets();
    setRunning(true);
    setResults([]);
    setMissed([]);
    setFinishedAt(null);
    setDone(0);
    setTotal(targets.length);

    for (let i = 0; i < targets.length; i += BATCH) {
      const chunk = targets.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/dev/site-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: chunk }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setMissed((p) => [...p, { paths: chunk, why: j?.error ?? `창구가 ${res.status} 로 답했습니다` }]);
        } else {
          const j = (await res.json()) as { results: CheckResult[] };
          setResults((p) => [...p, ...(j.results ?? [])]);
        }
      } catch (err) {
        setMissed((p) => [...p, { paths: chunk, why: String(err) }]);
      }
      setDone(i + chunk.length);
    }
    setFinishedAt(new Date().toLocaleTimeString("ko-KR"));
    setRunning(false);
  }

  const bad = results.filter((r) => r.verdict !== "정상");
  const withDead = results.filter((r) => r.deadLinks.length > 0);
  const shown = [...(onlyBad ? bad : results)].sort(
    (a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || b.ms - a.ms,
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black text-slate-800">🩺 사이트 점검</h2>
        <span className="text-[11px] text-slate-400">화면 {SCREENS.length}개를 실제로 열어봅니다</span>
        <button
          onClick={() => void run()}
          disabled={running}
          className="ml-auto rounded-lg bg-slate-900 px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
        >
          {running ? `점검 중… ${done}/${total}` : "한 바퀴 점검하기"}
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        안 열리는 화면 · 오류가 난 화면 · 로그인으로 튕기는 화면 · 눈에 띄게 느린 화면을 찾고, 화면 안의 링크가 실제로 있는
        곳을 가리키는지 봅니다. <b className="text-slate-600">저장·발송·삭제 단추는 누르지 않습니다</b> — 눌러보면 실제로
        저장되고 실제로 나갑니다.
      </p>

      {running && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-slate-800 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      )}

      {finishedAt && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px]">
          <b className="text-slate-700">{finishedAt} 점검 끝</b>
          <span className="text-emerald-700">정상 {results.length - bad.length}</span>
          {bad.length > 0 ? <span className="font-bold text-red-600">손봐야 할 것 {bad.length}</span> : <span className="text-slate-400">이상 없음</span>}
          {withDead.length > 0 && <span className="text-orange-700">끊긴 링크가 있는 화면 {withDead.length}</span>}
          <label className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} className="h-3 w-3" />
            문제만 보기
          </label>
        </div>
      )}

      {/* 못 본 묶음. 조용히 버리면 「전부 정상」으로 보입니다. */}
      {missed.length > 0 && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-[12px] font-bold text-red-700">점검하지 못한 화면이 있습니다</p>
          {missed.map((m, i) => (
            <p key={i} className="mt-0.5 text-[11px] text-red-800">
              {m.paths.join(" · ")} — {m.why}
            </p>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-100 text-[11px] text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-bold">화면</th>
                <th className="w-24 px-2 py-1.5 font-bold">판정</th>
                <th className="w-16 px-2 py-1.5 font-bold">걸린 시간</th>
                <th className="px-2 py-1.5 text-left font-bold">무엇이 문제인가</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.path} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <Link href={r.path} target="_blank" className="font-semibold text-slate-700 underline">
                      {r.path}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={"rounded-full border px-1.5 py-0.5 text-[10px] font-bold " + COLOR[r.verdict]}>{r.verdict}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-slate-500">{(r.ms / 1000).toFixed(1)}초</td>
                  <td className="px-2 py-1.5 text-slate-600">
                    {r.note}
                    {r.deadLinks.length > 0 && (
                      <span className="ml-1 text-orange-700">끊긴 링크: {r.deadLinks.slice(0, 4).join(" · ")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 화면별 속도 ────────────────────────────────────────────────────
          점검하면서 이미 시간을 재두었습니다. 표로만 두면 「어디가 느린가」를 눈으로 훑어야
          하는데, 막대로 그리면 한눈에 보입니다 - 조회를 더 하지 않고 그리는 그림입니다. */}
      {results.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <b className="text-slate-700">⏱ 느린 화면</b>
            <span className="text-slate-400">
              가장 느린 12개 · 가운뎃값 {(median(results.map((r) => r.ms)) / 1000).toFixed(1)}초 · 4초를 넘으면 빨강
            </span>
          </p>
          <div className="flex flex-col gap-1">
            {[...results]
              .sort((a, b) => b.ms - a.ms)
              .slice(0, 12)
              .map((r) => (
                <div key={r.path} className="flex items-center gap-2">
                  <span className="w-52 shrink-0 truncate text-[11px] text-slate-600">{r.path}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={"h-full rounded-full " + (r.ms > 4000 ? "bg-red-500" : r.ms > 2000 ? "bg-amber-400" : "bg-emerald-400")}
                      style={{ width: `${Math.max(2, Math.min(100, (r.ms / Math.max(...results.map((x) => x.ms))) * 100))}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
                    {(r.ms / 1000).toFixed(1)}초
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {finishedAt && shown.length === 0 && (
        <p className="rounded-lg bg-emerald-50 px-3 py-3 text-center text-[12px] font-bold text-emerald-700">
          {results.length}개 화면 모두 정상입니다.
        </p>
      )}
    </section>
  );
}
