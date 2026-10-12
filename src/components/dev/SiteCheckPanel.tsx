"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BATCH, SCREENS, SITE_CHECK_FRAME, allTargets, findClipped, type CheckResult, type ClipHit, type Verdict } from "@/lib/siteCheck";
import { useDevReport } from "@/components/dev/DevReportProvider";

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
  잘림: "text-red-700 bg-red-50 border-red-300",
};

/** 한 번에 그려 보는 화면 수. 많이 띄우면 점검하는 컴퓨터가 버거워 시간 초과가 늘어납니다. */
const MEASURE_PARALLEL = 3;
const MEASURE_TIMEOUT_MS = 20_000;
/** 다 열린 뒤 이만큼 더 기다립니다. 화면이 자료를 받아 그리는 데 걸리는 시간입니다. */
const SETTLE_MS = 1500;

/**
 * 화면 하나를 숨은 틀에 열어 그린 뒤 **잘린 상자**를 잽니다(findClipped).
 *
 * 창 크기는 행정실 노트북 정도(1280×820)로 둡니다. 큰 모니터에서만 재면 내용이 다 들어와
 * 멀쩡해 보이고, 정작 작은 화면에서 잘린 것은 못 잡습니다.
 */
function measure(path: string): Promise<ClipHit[] | string> {
  return new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.name = SITE_CHECK_FRAME;
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:820px;border:0;visibility:hidden;pointer-events:none";
    let done = false;
    const finish = (v: ClipHit[] | string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      f.remove();
      resolve(v);
    };
    const timer = setTimeout(() => finish(`${MEASURE_TIMEOUT_MS / 1000}초 안에 다 그려지지 않아 재지 못했습니다`), MEASURE_TIMEOUT_MS);
    f.onload = () =>
      setTimeout(() => {
        try {
          const doc = f.contentDocument;
          finish(doc ? findClipped(doc) : "화면을 읽지 못했습니다");
        } catch (err) {
          finish(`화면을 재지 못했습니다: ${String(err)}`);
        }
      }, SETTLE_MS);
    f.src = path;
    document.body.appendChild(f);
  });
}
/** 가운뎃값. 평균은 느린 화면 하나에 통째로 끌려가서 「보통 얼마나 걸리나」를 못 보여줍니다. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/** 위험한 순서. 사람이 위에서부터 읽고 손대면 됩니다. */
const ORDER: Verdict[] = ["오류", "안 열림", "없는 화면", "잘림", "로그인으로 튕김", "권한 막힘", "느림", "정상"];

/**
 * **고칠 수 있는 자리인가.**
 *
 * 점검이 문제를 찾아 주는데 화면에는 그것을 어떻게 하라는 말이 없었습니다. 판정마다 손댈 곳이
 * 전혀 다릅니다 - 느린 화면은 코드를 고쳐야 하고, 로그인으로 튕기는 화면은 계정 권한 문제일
 * 수 있습니다. 어느 쪽인지 안 적어두면 보는 사람은 셋 다 「내가 못 하는 것」으로 넘깁니다.
 */
const FIXABLE: Record<Verdict, { who: "코드" | "설정"; how: string }> = {
  정상: { who: "설정", how: "" },
  느림: { who: "코드", how: "조회를 줄이거나 나란히 부르도록 고쳐야 합니다." },
  오류: { who: "코드", how: "화면이 터졌습니다. 코드를 고쳐야 합니다." },
  "안 열림": { who: "코드", how: "주소가 없거나 서버가 답하지 않습니다. 코드를 고쳐야 합니다." },
  "없는 화면": { who: "코드", how: "가리키는 화면이 없습니다. 링크를 고치거나 화면을 만들어야 합니다." },
  "로그인으로 튕김": { who: "설정", how: "지금 계정으로 열 수 없는 화면입니다. 계정 권한을 확인해 주세요." },
  "권한 막힘": { who: "설정", how: "지금 계정으로 열 수 없는 화면입니다. 계정 권한을 확인해 주세요." },
  잘림: { who: "코드", how: "화면 아래가 잘려 굴려도 안 내려갑니다. 그 상자에 스크롤을 두거나 가두지 않게 고쳐야 합니다." },
};

export default function SiteCheckPanel({ gaps, version }: { gaps: { key: string; gap: string }[]; version: string }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [missed, setMissed] = useState<{ paths: string[]; why: string }[]>([]);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [onlyBad, setOnlyBad] = useState(true);
  const [copied, setCopied] = useState(false);
  /** 두 번째 단계(그려 보고 재기) 진행. 첫 단계와 따로 셉니다 - 어디서 시간이 드는지 보이게. */
  const [measuring, setMeasuring] = useState<{ done: number; total: number } | null>(null);
  /** 재지 못한 화면. 못 잰 것을 「정상」으로 두면 잘린 화면이 그대로 빠져나갑니다. */
  const [unmeasured, setUnmeasured] = useState<{ path: string; why: string }[]>([]);
  const report = useDevReport();

  async function run() {
    const targets = allTargets();
    setRunning(true);
    setResults([]);
    setMissed([]);
    setFinishedAt(null);
    setUnmeasured([]);
    setDone(0);
    setTotal(targets.length);

    const opened: CheckResult[] = [];
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
          opened.push(...(j.results ?? []));
          setResults((p) => [...p, ...(j.results ?? [])]);
        }
      } catch (err) {
        setMissed((p) => [...p, { paths: chunk, why: String(err) }]);
      }
      setDone(i + chunk.length);
    }
    // ── 두 번째 단계: 열린 화면을 실제로 그려 보고 잘린 곳을 잽니다 ──────────────
    const toMeasure = opened.filter((r) => !r.path.startsWith("/api") && (r.verdict === "정상" || r.verdict === "느림")).map((r) => r.path);
    setMeasuring({ done: 0, total: toMeasure.length });
    let next = 0;
    let measured = 0;
    const worker = async () => {
      while (next < toMeasure.length) {
        const path = toMeasure[next++];
        const out = await measure(path);
        measured += 1;
        setMeasuring({ done: measured, total: toMeasure.length });
        if (typeof out === "string") {
          setUnmeasured((p) => [...p, { path, why: out }]);
          continue;
        }
        if (out.length === 0) continue;
        const note = out.map((h) => `${h.where}에서 ${h.hiddenPx}px 가 가려져 굴려도 안 보입니다`).join(" · ");
        setResults((p) => p.map((r) => (r.path === path ? { ...r, verdict: "잘림", note } : r)));
      }
    };
    await Promise.all(Array.from({ length: MEASURE_PARALLEL }, worker));
    setMeasuring(null);

    setFinishedAt(new Date().toLocaleTimeString("ko-KR"));
    setRunning(false);
  }

  const bad = results.filter((r) => r.verdict !== "정상");
  const withDead = results.filter((r) => r.deadLinks.length > 0);
  /** 사람이 설정으로 풀 수 있는 것과, 코드를 고쳐야 하는 것. 손댈 곳이 다릅니다. */
  const byWho = {
    설정: bad.filter((r) => FIXABLE[r.verdict].who === "설정"),
    코드: bad.filter((r) => FIXABLE[r.verdict].who === "코드"),
  };

  /**
   * **개발자에게 그대로 붙여넣을 쪽지.**
   *
   * 점검이 찾아낸 것을 사람이 옮겨 적으면 「어느 화면이 몇 초였는지」가 빠집니다. 그러면
   * 받는 쪽이 다시 물어야 하고, 그 왕복 때문에 대부분은 아예 전달되지 않습니다. 화면이
   * 이미 갖고 있는 숫자를 그대로 담아 한 번에 옮깁니다.
   */
  function buildOwn(): string {
    const lines: string[] = [];
    lines.push(`# 운영앱 점검 결과 (v${version} · ${new Date().toLocaleString("ko-KR")})`);
    lines.push("");
    if (finishedAt) {
      lines.push(`화면 ${results.length}개 점검 · 정상 ${results.length - bad.length} · 손봐야 할 것 ${bad.length} · 끊긴 링크가 있는 화면 ${withDead.length}`);
    } else {
      lines.push("사이트 점검은 아직 안 돌렸습니다. [한 바퀴 점검하기]를 누른 뒤 다시 복사하면 결과가 함께 담깁니다.");
    }
    if (byWho.코드.length > 0) {
      lines.push("");
      lines.push("## 코드를 고쳐야 하는 것");
      for (const r of byWho.코드) lines.push(`- \`${r.path}\` — ${r.verdict} · ${(r.ms / 1000).toFixed(1)}초${r.note ? ` · ${r.note}` : ""}`);
    }
    if (byWho.설정.length > 0) {
      lines.push("");
      lines.push("## 계정·설정으로 풀리는 것");
      for (const r of byWho.설정) lines.push(`- \`${r.path}\` — ${r.verdict}${r.note ? ` · ${r.note}` : ""}`);
    }
    if (withDead.length > 0) {
      lines.push("");
      lines.push("## 끊긴 링크");
      for (const r of withDead) lines.push(`- \`${r.path}\` → ${r.deadLinks.join(" , ")}`);
    }
    if (missed.length > 0) {
      lines.push("");
      lines.push("## 점검하지 못한 화면");
      for (const m of missed) lines.push(`- ${m.paths.join(" · ")} — ${m.why}`);
    }
    if (unmeasured.length > 0) {
      lines.push("");
      lines.push("## 잘림을 재지 못한 화면");
      for (const u of unmeasured) lines.push(`- \`${u.path}\` — ${u.why}`);
    }
    if (gaps.length > 0) {
      lines.push("");
      lines.push("## 자료 등기소 — 넣기와 내리기가 아직 짝이 아닌 자리");
      for (const g of gaps) lines.push(`- **${g.key}** — ${g.gap}`);
    }
    if (results.length > 0) {
      lines.push("");
      lines.push("## 느린 화면 (위에서부터)");
      for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 8)) {
        lines.push(`- \`${r.path}\` ${(r.ms / 1000).toFixed(1)}초`);
      }
    }
    return lines.join("\n");
  }

  // 이 패널 몫을 쪽지 저장소에 올려둡니다. 복사 단추는 **저장소 전체**를 냅니다 -
  // 자료 등기소 같은 다른 패널이 찾은 것도 같은 쪽지에 담기게 하려고요.
  useEffect(() => {
    report.put("site", 10, buildOwn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, missed, unmeasured, finishedAt, gaps, version]);

  async function copyReport() {
    const text = report.build();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드를 못 쓰는 브라우저·환경이 있습니다. 조용히 실패하면 눌러도 아무 일이 없는
      // 것처럼 보이므로, 창을 하나 띄워 직접 고를 수 있게 합니다.
      window.prompt("아래 내용을 복사해 개발자에게 전달해 주세요.", text);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  const shown = [...(onlyBad ? bad : results)].sort(
    (a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || b.ms - a.ms,
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black text-slate-800">🩺 사이트 점검</h2>
        <span className="text-[11px] text-slate-400">화면 {SCREENS.length}개를 실제로 열어봅니다</span>
        <button
          onClick={() => void copyReport()}
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-600"
          title="점검 결과와 자료 등기소의 남은 자리를 한 덩어리로 복사합니다. 개발자에게 그대로 붙여넣으시면 됩니다."
        >
          {copied ? "복사했습니다" : `개발자에게 보낼 쪽지 복사${report.count > 1 ? ` (${report.count}칸)` : ""}`}
        </button>
        <button
          onClick={() => void run()}
          disabled={running}
          className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
        >
          {running
            ? measuring
              ? `화면 그려 보는 중… ${measuring.done}/${measuring.total}`
              : `점검 중… ${done}/${total}`
            : "한 바퀴 점검하기"}
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        안 열리는 화면 · 오류가 난 화면 · 로그인으로 튕기는 화면 · 눈에 띄게 느린 화면을 찾고, 화면 안의 링크가 실제로 있는
        곳을 가리키는지 봅니다. 그다음 열린 화면을 노트북 크기(1280×820)로 <b className="text-slate-600">실제로 그려 보고</b>, 아래가
        잘려 굴려도 안 내려가는 화면을 「잘림」으로 잡습니다. <b className="text-slate-600">저장·발송·삭제 단추는 누르지 않습니다</b> — 눌러보면 실제로
        저장되고 실제로 나갑니다.
      </p>
      <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
        결과마다 <b>손댈 곳</b>을 함께 적습니다. <b className="text-blue-700">설정</b>은 여기서 계정 권한을 확인하면 풀리고,
        <b className="text-slate-700"> 코드</b>는 화면에서 고칠 수 없습니다. 코드로 표시된 것은 <b>[개발자에게 보낼 쪽지 복사]</b>를
        누른 뒤 그대로 붙여넣어 주세요 — 어느 화면이 몇 초였는지까지 함께 담깁니다.
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
          {byWho.코드.length > 0 && <span className="text-slate-600">그중 코드 {byWho.코드.length}</span>}
          {byWho.설정.length > 0 && <span className="text-slate-600">계정·설정 {byWho.설정.length}</span>}
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

      {unmeasured.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-[12px] font-bold text-amber-800">잘림을 재지 못한 화면 {unmeasured.length}개 — 이 화면들은 아직 모릅니다</p>
          {unmeasured.slice(0, 8).map((u) => (
            <p key={u.path} className="mt-0.5 text-[11px] text-amber-900">
              {u.path} — {u.why}
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
                <th className="w-16 px-2 py-1.5 font-bold">손댈 곳</th>
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
                  {/* 손댈 곳을 안 적으면 보는 사람은 셋 다 「내가 못 하는 것」으로 넘깁니다. */}
                  <td className="px-2 py-1.5 text-center">
                    {r.verdict === "정상" ? (
                      <span className="text-slate-300">-</span>
                    ) : (
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-[10px] font-bold " +
                          (FIXABLE[r.verdict].who === "코드" ? "bg-slate-200 text-slate-700" : "bg-blue-100 text-blue-700")
                        }
                        title={FIXABLE[r.verdict].how}
                      >
                        {FIXABLE[r.verdict].who}
                      </span>
                    )}
                  </td>
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
