"use client";

import { useMemo, useState } from "react";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { Who } from "@/components/common/HomonymProvider";
import StudentLedgerModal from "@/components/finance/StudentLedgerModal";
import { won } from "@/lib/feeItems";

export type BatchRow = {
  billing_month: string;
  stream: "학비" | "학비외";
  issue_batch: string;
  issue_date: string;
  first_created_at: string;
  alive_count: number;
  cancelled_count: number;
  alive_amount: number | string;
  offline_count: number;
  issued_by: string | null;
};

export type BatchInvoice = {
  id: string;
  invoice_no: string;
  issue_batch: string | null;
  student_id: string | null;
  student_name: string;
  student_name_ko: string | null;
  total_amount: number | string;
  status: string;
  issued_offline: boolean | null;
};

const STREAMS = ["학비", "학비외"] as const;

/**
 * 청구월마다 학비·학비외가 **언제 몇 차로** 나갔는지. 회차를 누르면 그 차에 나간 아이들이
 * 펼쳐지고, 이름을 누르면 그 아이의 금전 창이 그 달로 열립니다.
 */
export default function RoundsClient({ batches, invoices, problems }: { batches: BatchRow[]; invoices: BatchInvoice[]; problems: string[] }) {
  useFinanceLive();
  const [open, setOpen] = useState<string | null>(null);
  const [student, setStudent] = useState<{ id: string; month: string } | null>(null);
  const [year, setYear] = useState<string>("전체");

  const years = useMemo(() => ["전체", ...[...new Set(batches.map((b) => b.billing_month.slice(0, 4)))].sort().reverse()], [batches]);
  const months = useMemo(() => {
    const map = new Map<string, BatchRow[]>();
    for (const b of batches) {
      if (year !== "전체" && !b.billing_month.startsWith(year)) continue;
      map.set(b.billing_month, [...(map.get(b.billing_month) ?? []), b]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [batches, year]);
  const byBatch = useMemo(() => {
    const m = new Map<string, BatchInvoice[]>();
    for (const v of invoices) if (v.issue_batch) m.set(v.issue_batch, [...(m.get(v.issue_batch) ?? []), v]);
    return m;
  }, [invoices]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-black text-slate-900">청구 회차</h1>
        <span className="text-[12px] text-slate-500">몇 월분을 언제 몇 차로 냈는가 · 회차 번호 = 발행일 _ 그날 몇 번째 묶음</span>
        <select value={year} onChange={(e) => setYear(e.target.value)} className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
          {years.map((y) => (
            <option key={y} value={y}>
              {y === "전체" ? "전체 연도" : `${y}년`}
            </option>
          ))}
        </select>
      </div>
      {problems.length > 0 && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">일부 자료를 못 읽었습니다: {problems.join(" / ")}</p>}
      {months.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500">회차가 붙은 청구서가 없습니다.</p>}

      {months.map(([month, rows]) => (
        <section key={month} className="rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] font-black text-slate-800">
            {month.replace("-", "년 ")}월분
            <span className="ml-2 text-[11px] font-semibold text-slate-500">
              {rows.reduce((n, r) => n + r.alive_count, 0)}장 · {won(rows.reduce((n, r) => n + Number(r.alive_amount), 0))}
            </span>
          </h2>
          <div className="grid gap-0 md:grid-cols-2">
            {STREAMS.map((st) => {
              const list = rows.filter((r) => r.stream === st).sort((a, b) => a.first_created_at.localeCompare(b.first_created_at));
              return (
                <div key={st} className="border-slate-100 p-2 md:border-l md:first:border-l-0">
                  <p className={"mb-1 text-[11px] font-black " + (st === "학비" ? "text-indigo-700" : "text-orange-700")}>{st}</p>
                  {list.length === 0 && <p className="text-[11px] text-slate-400">이 달 {st} 청구 없음</p>}
                  <ol className="space-y-1">
                    {list.map((r, i) => {
                      const key = `${month}|${st}|${r.issue_batch}`;
                      const items = (byBatch.get(r.issue_batch) ?? []).filter((v) => v.status !== "취소");
                      return (
                        <li key={key} className="rounded-lg border border-slate-200">
                          <button onClick={() => setOpen(open === key ? null : key)} className="flex w-full flex-wrap items-baseline gap-2 px-2 py-1 text-left text-[12px] hover:bg-slate-50">
                            <b className="text-slate-800">{i + 1}차</b>
                            {/* 「N차」는 이 달 이 갈래 안에서의 순서, 괄호 안 번호는 그날 몇 번째 묶음입니다. */}
                            <span className="text-slate-700">{r.issue_date.slice(5).replace("-", "/")} 발행</span>
                            <span className="font-mono text-[10px] text-slate-400">({r.issue_batch})</span>
                            <span className="ml-auto tabular-nums text-slate-600">
                              {r.alive_count}장 · <b className="text-slate-800">{won(Number(r.alive_amount))}</b>
                            </span>
                            {r.cancelled_count > 0 && <span className="text-[10px] text-slate-400">취소 {r.cancelled_count}</span>}
                            {r.offline_count > 0 && <span className="text-[10px] text-sky-600">직접수납 {r.offline_count}</span>}
                            {r.issued_by && <span className="w-full text-[10px] text-slate-400">발행 {r.issued_by}</span>}
                          </button>
                          {open === key && (
                            <ul className="max-h-72 overflow-y-auto border-t border-slate-100 px-2 py-1 text-[11px]">
                              {items.map((v) => (
                                <li key={v.id} className="flex items-center gap-2 py-0.5">
                                  {v.student_id ? (
                                    <button onClick={() => setStudent({ id: v.student_id as string, month })} className="font-semibold text-slate-800 hover:underline">
                                      <Who id={v.student_id} name={v.student_name_ko ?? v.student_name} />
                                    </button>
                                  ) : (
                                    <span>{v.student_name_ko ?? v.student_name}</span>
                                  )}
                                  <span className="text-slate-400">{v.invoice_no}</span>
                                  {v.issued_offline && <span className="text-[10px] text-sky-600">직접수납</span>}
                                  <span className="ml-auto tabular-nums">{won(Number(v.total_amount))}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {student && <StudentLedgerModal studentId={student.id} month={student.month} onClose={() => setStudent(null)} />}
    </div>
  );
}
