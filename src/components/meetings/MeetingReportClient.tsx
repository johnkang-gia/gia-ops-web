"use client";

import { useMemo, useState } from "react";
import type { Meeting } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";
import { type ReportPeriodType, PERIOD_TYPE_LABEL, getReportRange, shiftAnchor, toDateStr } from "@/lib/reportPeriod";

const GUIDE_SECTIONS = [
  {
    title: "💬 회의 보고서란?",
    lines: [
      "구두로만 공유되고 끝나던 회의 내용을 일간·주간·월간 단위 문서로 정리합니다. 그 기간에 있었던 회의를 날짜순으로 모아 보여줍니다.",
      "상단에서 일간/주간/월간을 고르고 ◀ ▶ 로 원하는 기간으로 이동한 뒤, \"🖨 인쇄/PDF\" 버튼을 누르면 새 탭에 인쇄용 문서가 열립니다.",
    ],
  },
];

function oneLine(text: string | null, maxLen = 120) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default function MeetingReportClient({ meetings }: { meetings: Meeting[] }) {
  const [periodType, setPeriodType] = useState<ReportPeriodType>("week");
  const [anchor, setAnchor] = useState<Date>(new Date());

  const range = useMemo(() => getReportRange(periodType, anchor), [periodType, anchor]);

  const inRange = useMemo(
    () => meetings.filter((m) => m.date >= range.start && m.date <= range.end).sort((a, b) => a.date.localeCompare(b.date)),
    [meetings, range]
  );

  const pdfHref = `/api/meetings/report/pdf?type=${periodType}&date=${toDateStr(anchor)}`;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">💬 회의 보고서</h1>
          <p className="mt-0.5 text-xs text-slate-500">일간·주간·월간 단위로 회의 기록을 문서로 정리합니다.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={pdfHref}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            🖨 인쇄/PDF
          </a>
          <GuideButton title="회의 보고서 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(["day", "week", "month"] as ReportPeriodType[]).map((t) => (
            <button
              key={t}
              onClick={() => setPeriodType(t)}
              className={
                "rounded-md px-3 py-1 text-xs font-semibold transition " +
                (periodType === t ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-50")
              }
            >
              {PERIOD_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAnchor((a) => shiftAnchor(periodType, a, -1))}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            ◀
          </button>
          <span className="min-w-[10rem] rounded-lg bg-slate-100 px-2.5 py-1 text-center text-xs font-semibold text-slate-700">
            {range.label}
          </span>
          <button
            onClick={() => setAnchor((a) => shiftAnchor(periodType, a, 1))}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            ▶
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            오늘
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">📋 이 기간의 회의 ({inRange.length}건)</h2>
          {inRange.length === 0 ? (
            <p className="text-xs text-slate-400">이 기간에 기록된 회의가 없습니다.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {inRange.map((m) => (
                <div key={m.id} className="py-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-400">{m.date}</span>
                    {m.attendees && <span className="text-[11px] text-slate-500">참석: {m.attendees}</span>}
                    {m.status && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{m.status}</span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">
                    {oneLine(m.final_record || m.content, 300)}
                  </p>
                  {m.next_agenda && (
                    <p className="mt-1 text-[11px] text-blue-600">다음 안건: {oneLine(m.next_agenda, 150)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
