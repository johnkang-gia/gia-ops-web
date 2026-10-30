"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BATCH, SCREENS, SITE_CHECK_FRAME, allTargets, inspectRendered, stillLoading, type CheckResult, type RenderIssue, type Verdict } from "@/lib/siteCheck";
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
  먹통: "text-red-700 bg-red-50 border-red-300",
  "화면 오류": "text-red-700 bg-red-50 border-red-300",
};

/**
 * 그려 볼 창 크기. 행정실 노트북과 휴대폰(도착체크·담임 화면은 휴대폰으로 엽니다).
 * 큰 모니터에서만 재면 내용이 다 들어와 멀쩡해 보이고, 작은 화면에서 잘린 것은 못 잡습니다.
 */
const VIEWPORTS = [
  { label: "노트북", w: 1280, h: 820 },
  { label: "휴대폰", w: 390, h: 844 },
] as const;
/** 로딩이 이만큼 지나도 안 끝나면 «끝나지 않는 로딩»입니다. */
const LOADING_GRACE_MS = 6000;
const LAST_RUN_KEY = "gia-site-check-last";

/** 한 번에 그려 보는 화면 수. 많이 띄우면 점검하는 컴퓨터가 버거워 시간 초과가 늘어납니다. */
const MEASURE_PARALLEL = 3;
const MEASURE_TIMEOUT_MS = 25_000;
/** 다 열린 뒤 이만큼 더 기다립니다. 화면이 자료를 받아 그리는 데 걸리는 시간입니다. */
const SETTLE_MS = 1500;

/**
 * 화면 하나를 숨은 틀에 열어 그린 뒤 **종합 진찰**합니다(inspectRendered): 잘림·먹통·화면 오류.
 * 로딩 뱅글이가 보이면 조금 더 기다렸다가, 그래도 안 끝나면 «끝나지 않는 로딩»으로 적습니다.
 */
function measure(path: string, vp: { w: number; h: number }): Promise<RenderIssue[] | string> {
  return new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.name = SITE_CHECK_FRAME;
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = `position:fixed;left:-20000px;top:0;width:${vp.w}px;height:${vp.h}px;border:0;visibility:hidden;pointer-events:none`;
    let done = false;
    const finish = (v: RenderIssue[] | string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      f.remove();
      resolve(v);
    };
    const timer = setTimeout(() => finish(`${MEASURE_TIMEOUT_MS / 1000}초 안에 다 그려지지 않아 재지 못했습니다`), MEASURE_TIMEOUT_MS);
    f.onload = () =>
      setTimeout(async () => {
        try {
          const doc = f.contentDocument;
          if (!doc) return finish("화면을 읽지 못했습니다");
          // 로그인 화면으로 끌려갔으면 그 화면을 잰 것이 됩니다. 재지 않은 것으로 적습니다.
          if (/\/login(\?|$)/.test(f.contentWindow?.location.pathname ?? "")) return finish("로그인 화면으로 넘어가 재지 못했습니다");
          let waited = 0;
          while (stillLoading(doc) && waited < LOADING_GRACE_MS) {
            await new Promise((r) => setTimeout(r, 500));
            waited += 500;
          }
          const issues = inspectRendered(doc);
          if (stillLoading(doc)) issues.push({ kind: "먹통", text: `${(SETTLE_MS + LOADING_GRACE_MS) / 1000}초가 지나도 로딩이 끝나지 않습니다` });
          finish(issues);
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
const ORDER: Verdict[] = ["오류", "안 열림", "없는 화면", "화면 오류", "먹통", "잘림", "로그인으로 튕김", "권한 막힘", "느림", "정상"];

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
  먹통: { who: "코드", how: "눌러도 반응이 없을 수 있습니다(덮은 막·끝나지 않는 로딩·긴 멈춤). 코드를 고쳐야 합니다." },
  "화면 오류": { who: "코드", how: "화면 안에서 오류가 났습니다. 열리긴 해도 일부 기능이 안 될 수 있습니다." },
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
  /** 휴대폰 크기로도 그려 볼지. 시간이 두 배 들지만 휴대폰으로 여는 화면이 많습니다. */
  const [mobileToo, setMobileToo] = useState(true);
  /** 지난번 점검의 문제 목록. 이번에 «새로 생긴» 것을 가리는 데 씁니다(없으면 첫 점검). */
  const [prevBad, setPrevBad] = useState<Set<string> | null>(null);
  /** 여러 화면에 똑같이 난 문제(원인이 공통 부품 하나인 것). */
  const [common, setCommon] = useState<{ kind: RenderIssue["kind"]; text: string; count: number }[]>([]);
  const report = useDevReport();

  async function run() {
    const targets = allTargets();
    setRunning(true);
    setResults([]);
    setMissed([]);
    setFinishedAt(null);
    setUnmeasured([]);
    setCommon([]);
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
    // ── 두 번째 단계: 열린 화면을 노트북·휴대폰 크기로 실제로 그려 보고 진찰합니다 ──────
    // 다른 주소로 넘겨주기만 하는 화면(예: 이번 달 화면으로 보내는 주소)은 그리지 않습니다. 넘어간 화면은
    // 따로 점검 목록에 있고, 넘어가는 순간을 재면 «빈 본문»으로 헛걸립니다.
    const pages = opened
      .filter((r) => !r.path.startsWith("/api") && !r.redirectedTo && (r.verdict === "정상" || r.verdict === "느림"))
      .map((r) => r.path);
    const jobs = pages.flatMap((path) => VIEWPORTS.filter((v) => mobileToo || v.label === "노트북").map((v) => ({ path, v })));
    setMeasuring({ done: 0, total: jobs.length });
    const found = new Map<string, { kind: RenderIssue["kind"]; text: string }[]>();
    let next = 0;
    let measured = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const { path, v } = jobs[next++];
        const out = await measure(path, v);
        measured += 1;
        setMeasuring({ done: measured, total: jobs.length });
        if (typeof out === "string") {
          setUnmeasured((p) => [...p, { path: `${path} (${v.label})`, why: out }]);
          continue;
        }
        if (out.length === 0) continue;
        const list = found.get(path) ?? [];
        for (const i of out) list.push({ kind: i.kind, text: `[${v.label}] ${i.text}` });
        found.set(path, list);
      }
    };
    await Promise.all(Array.from({ length: MEASURE_PARALLEL }, worker));
    setMeasuring(null);

    // ── 여러 화면에 똑같이 나는 문제는 «공통 문제»로 한 번만 ─────────────────────
    //
    // 첫 점검에서 하이드레이션 오류(React #418) 하나가 110개 화면에 똑같이 찍혔습니다. 그러면
    // 표가 온통 빨개져 정작 그 화면에만 있는 잘림·먹통이 묻힙니다. 같은 글이 여러 화면에 나면
    // 원인은 화면마다가 아니라 공통 부품 하나이므로, 위에 한 줄로 올리고 화면 판정에서는 뺍니다.
    const bare = (t: string) => t.replace(/^\[[^\]]+\]\s*/, "");
    const spread = new Map<string, { kind: RenderIssue["kind"]; paths: Set<string> }>();
    for (const [path, list] of found) {
      for (const i of list) {
        const k = bare(i.text);
        const cur = spread.get(k) ?? { kind: i.kind, paths: new Set<string>() };
        cur.paths.add(path);
        spread.set(k, cur);
      }
    }
    const threshold = Math.max(8, Math.ceil(pages.length * 0.3));
    const commons = [...spread.entries()]
      .filter(([, v]) => v.paths.size >= threshold)
      .map(([text, v]) => ({ kind: v.kind, text, count: v.paths.size }))
      .sort((a, b) => b.count - a.count);
    setCommon(commons);
    const commonSet = new Set(commons.map((c) => c.text));
    const finalOf = (r: CheckResult): CheckResult => {
      const list = (found.get(r.path) ?? []).filter((i) => !commonSet.has(bare(i.text)));
      if (list.length === 0) return r;
      // 가장 무거운 판정 하나를 화면의 판정으로 씁니다. 나머지는 설명에 모두 남깁니다.
      const worst = (["화면 오류", "먹통", "잘림"] as const).find((k) => list.some((i) => i.kind === k))!;
      return { ...r, verdict: worst, note: list.map((i) => `${i.kind} · ${i.text}`).join(" ／ ") };
    };
    const finals = opened.map(finalOf);
    setResults(finals);

    // 지난번 결과와 견줘 «새로 생긴 문제»를 표시합니다. 아침마다 같은 목록을 보면 새로 깨진
    // 것이 묻힙니다.
    {
      const now = [
        ...finals.filter((r) => r.verdict !== "정상").map((r) => `${r.path}|${r.verdict}`),
        ...commons.map((c) => `공통|${c.text}`),
      ];
      try {
        const prev = JSON.parse(localStorage.getItem(LAST_RUN_KEY) ?? "null") as string[] | null;
        setPrevBad(prev ? new Set(prev) : null);
        localStorage.setItem(LAST_RUN_KEY, JSON.stringify(now));
      } catch {
        // 저장소를 못 쓰는 브라우저. 비교만 못 할 뿐 점검 결과는 그대로입니다.
        setPrevBad(null);
      }
    }

    setFinishedAt(new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" }));
    setRunning(false);
  }

  const bad = results.filter((r) => r.verdict !== "정상");
  const isNew = (r: CheckResult) => !!prevBad && r.verdict !== "정상" && !prevBad.has(`${r.path}|${r.verdict}`);
  const newBad = bad.filter(isNew);
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
    lines.push(`# 운영앱 점검 결과 (v${version} · ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`);
    lines.push("");
    if (finishedAt) {
      lines.push(`화면 ${results.length}개 점검 · 정상 ${results.length - bad.length} · 손봐야 할 것 ${bad.length} · 끊긴 링크가 있는 화면 ${withDead.length}`);
      if (newBad.length > 0) lines.push(`지난번 점검보다 새로 생긴 문제 ${newBad.length}: ${newBad.map((r) => `\`${r.path}\` ${r.verdict}`).join(", ")}`);
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
    if (common.length > 0) {
      lines.push("");
      lines.push("## 여러 화면 공통 문제 (공통 부품 하나를 고치면 함께 풀림)");
      for (const c of common) lines.push(`- ${c.kind} · ${c.count}개 화면 — ${c.text}${prevBad && !prevBad.has(`공통|${c.text}`) ? " (새로 생김)" : ""}`);
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
  }, [results, missed, unmeasured, finishedAt, gaps, version, prevBad, common]);

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
        <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-500" title="휴대폰 크기(390×844)로도 그려 봅니다. 시간이 두 배 걸립니다.">
          <input type="checkbox" checked={mobileToo} disabled={running} onChange={(e) => setMobileToo(e.target.checked)} className="h-3 w-3" />
          휴대폰 크기도
        </label>
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
        곳을 가리키는지 봅니다. 그다음 열린 화면을 <b className="text-slate-600">노트북·휴대폰 크기로 실제로 그려 보고</b> 사람이 쓰는
        모습대로 진찰합니다 — <b>잘림</b>(굴려도 안 내려감·옆으로 잘림·페이지 스크롤 잠김), <b>먹통</b>(화면을 덮은 막·가려서 안 눌리는 단추·끝나지
        않는 로딩·오래 멈춤), <b>화면 오류</b>(화면 안 오류·빈 화면). <b className="text-slate-600">저장·발송·삭제 단추는 누르지 않습니다</b> —
        눌러보면 실제로 저장되고 실제로 나갑니다. 대신 «그 단추가 눌리는 자리에 있는가»를 봅니다.
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
          {prevBad && newBad.length > 0 && <span className="rounded bg-red-600 px-1.5 py-0.5 font-bold text-white">지난번보다 새로 생김 {newBad.length}</span>}
          {prevBad && newBad.length === 0 && bad.length > 0 && <span className="text-slate-500">새로 생긴 문제 없음(지난번과 같음)</span>}
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

      {common.length > 0 && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-[12px] font-bold text-red-700">여러 화면 공통 문제 — 공통 부품 하나를 고치면 함께 풀립니다</p>
          {common.map((c) => (
            <p key={c.text} className="mt-0.5 text-[11px] text-red-900">
              <b>{c.kind}</b> · {c.count}개 화면 — {c.text}
              {prevBad && !prevBad.has(`공통|${c.text}`) && <span className="ml-1 rounded bg-red-600 px-1 text-[9px] font-bold text-white">새로</span>}
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
                    {isNew(r) && <span className="ml-1 rounded bg-red-600 px-1 text-[9px] font-bold text-white">새로</span>}
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
