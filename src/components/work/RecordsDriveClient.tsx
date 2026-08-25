"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import WorkTabs from "./WorkTabs";

// 기록 드라이브(요청 ④): 사건·회의·행사를 드라이브처럼 연 → 월 폴더로 내려가며 탐색 + 검색.
// 왼쪽에 연/월 트리(건수 배지), 오른쪽에 그 달의 기록 목록. 검색하면 전체 기간에서 찾습니다.
export type DriveItem = {
  kind: "사건" | "회의" | "행사";
  caseId: string;
  date: string; // yyyy-MM-dd
  title: string;
  body: string;
  href: string;
};

const KIND_STYLE: Record<DriveItem["kind"], string> = {
  사건: "bg-blue-100 text-blue-700",
  회의: "bg-purple-100 text-purple-700",
  행사: "bg-pink-100 text-pink-700",
};

export default function RecordsDriveClient({ items }: { items: DriveItem[] }) {
  const router = useRouter();
  const [kinds, setKinds] = useState<Set<DriveItem["kind"]>>(new Set(["사건", "회의", "행사"]));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<{ year: string; month: string | null } | null>(null);
  const [open, setOpen] = useState<DriveItem | null>(null);

  const filtered = useMemo(() => items.filter((i) => kinds.has(i.kind)), [items, kinds]);

  // 연 → 월 트리 (건수 포함)
  const tree = useMemo(() => {
    const years = new Map<string, Map<string, number>>();
    for (const i of filtered) {
      const y = i.date.slice(0, 4);
      const m = i.date.slice(5, 7);
      const months = years.get(y) ?? years.set(y, new Map()).get(y)!;
      months.set(m, (months.get(m) ?? 0) + 1);
    }
    return [...years.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([y, months]) => ({
        year: y,
        total: [...months.values()].reduce((s, v) => s + v, 0),
        months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      }));
  }, [filtered]);

  const q = query.trim();
  const results = useMemo(() => {
    let list = filtered;
    if (q) {
      // 검색은 전체 기간에서 (연/월 선택 무시)
      list = list.filter((i) => i.title.includes(q) || i.body.includes(q));
    } else if (sel) {
      list = list.filter((i) => i.date.slice(0, 4) === sel.year && (!sel.month || i.date.slice(5, 7) === sel.month));
    } else if (tree.length > 0) {
      // 아무것도 안 골랐으면 최신 연도
      list = list.filter((i) => i.date.slice(0, 4) === tree[0].year);
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);
  }, [filtered, q, sel, tree]);

  function toggleKind(k: DriveItem["kind"]) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next.size === 0 ? new Set<DriveItem["kind"]>(["사건", "회의", "행사"]) : next;
    });
  }

  const headerLabel = q
    ? `"${q}" 검색 결과`
    : sel
      ? `${sel.year}년${sel.month ? ` ${Number(sel.month)}월` : " 전체"}`
      : tree.length > 0
        ? `${tree[0].year}년 (최근)`
        : "기록";

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <WorkTabs />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">🗄️ 기록 드라이브</h1>
        <div className="flex gap-1">
          {(["사건", "회의", "행사"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
                (kinds.has(k) ? KIND_STYLE[k] : "bg-slate-100 text-slate-400")
              }
            >
              {k}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="전체 기간에서 검색 (제목·내용)"
          className="ml-auto w-64 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr]">
        {/* 연/월 트리 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
          {tree.length === 0 && <p className="py-4 text-center text-xs text-slate-300">기록 없음</p>}
          {tree.map((y) => (
            <div key={y.year} className="mb-1.5">
              <button
                type="button"
                onClick={() => { setSel({ year: y.year, month: null }); setQuery(""); }}
                className={
                  "flex w-full items-center justify-between rounded-lg px-2 py-1 text-sm font-bold transition " +
                  (sel?.year === y.year && !sel?.month ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50")
                }
              >
                <span>📁 {y.year}년</span>
                <span className="text-[10px] font-semibold text-slate-400">{y.total}</span>
              </button>
              <div className="ml-3 mt-0.5 flex flex-col">
                {y.months.map(([m, cnt]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setSel({ year: y.year, month: m }); setQuery(""); }}
                    className={
                      "flex items-center justify-between rounded-md px-2 py-0.5 text-xs transition " +
                      (sel?.year === y.year && sel?.month === m ? "bg-blue-50 font-bold text-blue-700" : "text-slate-500 hover:bg-slate-50")
                    }
                  >
                    <span>{Number(m)}월</span>
                    <span className="text-[10px] text-slate-300">{cnt}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 결과 목록 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-sm text-slate-700">{headerLabel}</b>
            <span className="text-[11px] text-slate-400">{results.length}건{results.length === 300 ? "+ (최대 300건 표시)" : ""}</span>
          </div>
          {results.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">{q ? "검색 결과가 없습니다." : "이 기간의 기록이 없습니다."}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {results.map((i) => (
                <button
                  key={i.kind + i.caseId}
                  type="button"
                  onClick={() => setOpen(i)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50"
                >
                  <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " + KIND_STYLE[i.kind]}>{i.kind}</span>
                  <span className="shrink-0 rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-400">
                    {i.date.slice(2).replace(/-/g, ".")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{i.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 상세 보기 */}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-3">
              <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + KIND_STYLE[open.kind]}>{open.kind}</span>
              <b className="min-w-0 flex-1 truncate text-sm text-slate-800">{open.title}</b>
              <span className="shrink-0 text-[11px] text-slate-400">{open.date}</span>
              <button onClick={() => setOpen(null)} className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{open.body || "(내용 없음)"}</p>
            </div>
            <div className="flex shrink-0 justify-end border-t border-black/5 px-4 py-2.5">
              <button
                onClick={() => router.push(open.href)}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
              >
                {open.kind}기록 화면에서 열기 →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
