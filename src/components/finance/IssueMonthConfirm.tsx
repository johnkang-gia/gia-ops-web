"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { todayKst } from "@/lib/kst";
import { shiftMonth } from "@/lib/financePeriod";

/**
 * **발행 직전 «몇 월분»을 한 번 더 확인합니다.**
 *
 * 청구서의 «몇 월분»은 재무 화면이 보고 있는 달인데, 그 달은 브라우저에 남습니다. 다음 달을 한 번 열어 본 뒤
 * 발행하면 이번 달 청구서가 다음 달분으로 찍혔고(10월 28일 발행분 59장), 다음 달 칸이 잠겨 그 달 청구를 못
 * 했습니다. 10월에 11월분을 미리 내는 일도 있어서 막지는 않습니다 - 발행할 때마다 «○월 청구서로 발행합니다»를
 * 보이고, 틀렸으면 그 자리에서 달을 바꿔 발행합니다.
 *
 * 쓰는 법: `const [askMonth, monthDialog] = useIssueMonthConfirm();` → 화면에 `{monthDialog}` →
 * 발행 함수에서 `const bm = await askMonth(month, "3명"); if (!bm) return;` 후 `bm` 으로 발행.
 */
export function useIssueMonthConfirm(): [(month: string, what?: string) => Promise<string | null>, ReactNode] {
  const [state, setState] = useState<{ month: string; what?: string } | null>(null);
  const [picked, setPicked] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = useCallback((month: string, what?: string) => {
    setPicked(month);
    setState({ month, what });
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const done = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
  };

  const now = todayKst().slice(0, 7);
  const label = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
  const options = state ? Array.from({ length: 7 }, (_, i) => shiftMonth(now, i - 3)) : [];
  if (state && !options.includes(state.month)) options.push(state.month);

  const dialog = state ? (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => done(null)}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[15px] font-black text-slate-900">
          <span className={picked === now ? "text-emerald-700" : "text-amber-700"}>{label(picked)}</span> 청구서로 발행합니다
        </p>
        {state.what && <p className="mt-0.5 text-[12px] text-slate-500">{state.what}</p>}
        <label className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-slate-600">
          몇 월분
          <select value={picked} onChange={(e) => setPicked(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[13px] font-bold">
            {options.sort().map((m) => (
              <option key={m} value={m}>
                {label(m)}분{m === now ? " (이번 달)" : m > now ? " (미리)" : ""}
              </option>
            ))}
          </select>
        </label>
        {picked !== now && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            오늘은 {label(now)}입니다. {picked > now ? "다음 달 것을 미리 내는 것이 맞으면" : "지난달 것을 지금 내는 것이 맞으면"} 그대로 발행하세요.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => done(null)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-[12px] font-bold text-slate-600">
            취소
          </button>
          <button onClick={() => done(picked)} autoFocus className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700">
            {Number(picked.slice(5))}월분으로 발행
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [ask, dialog];
}
