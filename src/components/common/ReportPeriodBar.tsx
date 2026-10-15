"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { type ReportPeriodType, PERIOD_TYPE_LABEL, shiftAnchor } from "@/lib/reportPeriod";

/**
 * 보고서 화면의 기간 고르개(일간·주간·월간 + ◀ 기간 ▶ + 오늘). 회의 보고서와 업무 보고서가 같은 줄을 각자 적고 있어
 * 한쪽만 고쳐질 수 있었습니다. 화면마다 다른 고르개(부서 등)는 `children` 으로 뒤에 붙입니다.
 */
export default function ReportPeriodBar({
  periodType,
  setPeriodType,
  setAnchor,
  label,
  children,
}: {
  periodType: ReportPeriodType;
  setPeriodType: (t: ReportPeriodType) => void;
  setAnchor: Dispatch<SetStateAction<Date>>;
  label: string;
  children?: ReactNode;
}) {
  const nav = "g-panel-solid px-2 py-1 text-xs text-slate-500 hover:bg-slate-50";
  return (
    <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
      <div className="flex gap-1 g-panel-solid p-1">
        {(["day", "week", "month"] as ReportPeriodType[]).map((t) => (
          <button
            key={t}
            onClick={() => setPeriodType(t)}
            className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (periodType === t ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-50")}
          >
            {PERIOD_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => setAnchor((a) => shiftAnchor(periodType, a, -1))} className={nav}>
          ◀
        </button>
        <span className="min-w-[10rem] rounded-lg bg-slate-100 px-2.5 py-1 text-center text-xs font-semibold text-slate-700">{label}</span>
        <button onClick={() => setAnchor((a) => shiftAnchor(periodType, a, 1))} className={nav}>
          ▶
        </button>
        <button onClick={() => setAnchor(new Date())} className={nav}>
          오늘
        </button>
      </div>
      {children}
    </div>
  );
}
