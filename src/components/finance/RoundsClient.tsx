"use client";

import { useMemo, useState } from "react";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { Who } from "@/components/common/HomonymProvider";
import StudentLedgerModal from "@/components/finance/StudentLedgerModal";
import { won } from "@/lib/feeItems";
import { invoiceStatus } from "@/lib/billStatus";
import { StatusBadge } from "@/components/finance/StatusBadge";
import type { SettlePayment } from "@/lib/settlement";

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
  issue_date: string;
  due_date: string;
  carried_to_invoice_id?: string | null;
  written_off_amount?: number | string | null;
  exported_at?: string | null;
};

const STREAMS = ["학비", "학비외"] as const;

/**
 * 청구월마다 학비·학비외가 **언제 몇 차로** 나갔는지. 회차를 누르면 그 차에 나간 아이들이
 * 펼쳐지고, 이름을 누르면 그 아이의 금전 창이 그 달로 열립니다.
 */
export default function RoundsClient({
  batches,
  invoices,
  payments,
  today,
  problems,
}: {
  batches: BatchRow[];
  invoices: BatchInvoice[];
  payments: SettlePayment[];
  today: string;
  problems: string[];
}) {
  useFinanceLive();
  /**
   * **장마다 수납 상태.** 보낸 뒤 「들어왔나 안 들어왔나」를 이 화면에서 바로 봅니다. 계산은 금전
   * 창·청구 화면과 같은 함수(`invoiceStatus`)라 어디서 보든 같은 답입니다.
   */
  const stateOf = useMemo(() => {
    const m = new Map<string, NonNullable<ReturnType<typeof invoiceStatus>>>();
    for (const v of invoices) {
      const r = invoiceStatus({ ...v, student_id: v.student_id ?? null }, payments, today);
      if (r) m.set(v.id, r);
    }
    return m;
  }, [invoices, payments, today]);
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
        <span className="text-[12px] text-slate-500">
          몇 월분을 언제 몇 차로 냈는가 · 회차를 펼치면 장마다 <b>완납·일부·미납</b>이 보입니다. 미납은 수납이 들어올 때까지 다음 달로 밀리고,
          [청구 → 학비]의 「지난 미납」 칸에서 이번 달 장에 합치거나 따로 보냅니다.
        </span>
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
                            {(() => {
                              // 보낸 뒤 확인: 이 차에서 몇 장이 들어왔고 몇 장이 남았나.
                              const st = items.map((v) => stateOf.get(v.id)).filter((x): x is NonNullable<typeof x> => !!x);
                              const done = st.filter((x) => x.status === "완납" || x.status === "결손").length;
                              const carried = st.filter((x) => x.status === "이월").length;
                              const open = st.filter((x) => x.balance > 0 && x.status !== "이월");
                              const openSum = open.reduce((n, x) => n + x.balance, 0);
                              return (
                                <span className="flex items-center gap-1 text-[10px]">
                                  <span className="rounded bg-emerald-100 px-1 font-bold text-emerald-800">완납 {done}</span>
                                  {open.length > 0 && (
                                    <span className="rounded bg-rose-100 px-1 font-bold text-rose-800">미납 {open.length}장 · {won(openSum)}</span>
                                  )}
                                  {carried > 0 && <span className="rounded bg-slate-200 px-1 font-bold text-slate-600">이월 {carried}</span>}
                                </span>
                              );
                            })()}
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
                                  {(() => {
                                    const st = stateOf.get(v.id);
                                    if (!st) return null;
                                    return (
                                      <StatusBadge
                                        status={st.status}
                                        suffix={st.balance > 0 && st.status !== "이월" ? `남은 ${won(st.balance)}` : undefined}
                                      />
                                    );
                                  })()}
                                  {!v.exported_at && !v.issued_offline && <span className="text-[10px] text-amber-600">올톡 안 보냄</span>}
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
