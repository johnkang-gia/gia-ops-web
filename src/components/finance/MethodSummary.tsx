"use client";

import { won } from "@/lib/feeItems";
import { monthlyByMethod } from "@/lib/settlement";
import { PAYMENT_METHOD_KINDS, needsCashReceipt, type PaymentRow } from "@/lib/payments";

/**
 * 달마다 어떤 수단으로 얼마가 들어왔나.
 *
 * 합계만 알면 두 가지를 놓칩니다. **현금·계좌이체는 현금영수증을 우리가 발행해야 하고**,
 * 카드는 수수료가 붙습니다. 수단을 갈라 세야 그 둘을 챙길 수 있습니다.
 *
 * 수단이 비어 있는 옛 줄은 「기타」로 셉니다 - 빼버리면 합계가 안 맞고, 안 맞는 표는
 * 아무도 안 믿습니다.
 */
export default function MethodSummary({ payments }: { payments: PaymentRow[] }) {
  const months = monthlyByMethod(payments, 6);
  const kinds = [...PAYMENT_METHOD_KINDS];

  if (months.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <h2 className="mb-1 text-sm font-bold text-slate-800">💳 월별 · 수단별 수납</h2>
        <p className="text-[12px] text-slate-400">아직 들어온 돈이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3">
      <h2 className="mb-1 text-sm font-bold text-slate-800">💳 월별 · 수단별 수납</h2>
      <p className="mb-2 text-[11px] text-slate-500">
        최근 6개월. <b>현금·계좌이체</b>는 현금영수증을 따로 발행해야 하는 몫입니다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="px-2 py-1.5">달</th>
              {kinds.map((k) => (
                <th key={k} className={"px-2 py-1.5 text-right " + (needsCashReceipt(k) ? "text-amber-700" : "")}>
                  {k}
                  {needsCashReceipt(k) && <span title="현금영수증 발행 대상"> ·</span>}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">합계</th>
              <th className="px-2 py-1.5 text-right">건수</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-slate-100">
                <td className="px-2 py-1.5 font-bold tabular-nums text-slate-700">{m.month}</td>
                {kinds.map((k) => (
                  <td
                    key={k}
                    className={
                      "px-2 py-1.5 text-right tabular-nums " +
                      (m.byMethod[k] ? (needsCashReceipt(k) ? "font-semibold text-amber-800" : "text-slate-600") : "text-slate-300")
                    }
                  >
                    {m.byMethod[k] ? won(m.byMethod[k]) : "—"}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-900">{won(m.total)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{m.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
