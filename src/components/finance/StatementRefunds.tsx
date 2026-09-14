"use client";

import { useState } from "react";
import RefundModal, { type RefundTarget } from "./RefundModal";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/**
 * 거래명세서에서 **돈이 들어온 청구서마다** 환불 단추를 답니다.
 *
 * 환불 이야기는 대개 학부모 전화로 시작하고, 그때 담당자가 보고 있는 화면이 이것입니다.
 * 수납 화면으로 옮겨가게 하면 「나중에」가 되고, 나중에 한 것은 대개 안 한 것이 됩니다.
 *
 * **인쇄본에서는 빠집니다**(`print:hidden`). 학부모에게 드리는 종이에 담당자용 단추가
 * 보이면 안 됩니다.
 */
export default function StatementRefunds({ rows }: { rows: Omit<RefundTarget, "suggest" | "method">[] }) {
  const [target, setTarget] = useState<RefundTarget | null>(null);
  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 print:hidden">
      <p className="text-[11px] font-bold text-slate-600">↩️ 환불 적기</p>
      <p className="mt-0.5 text-[10px] text-slate-500">
        원래 입금 줄은 지우지 않고 반대 방향 한 줄을 더합니다 — 그래야 그날 수납 집계가 그대로 남습니다.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <button
            key={r.invoiceId}
            type="button"
            onClick={() => setTarget({ ...r, suggest: r.held })}
            className="rounded border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
          >
            {r.invoiceNo} <span className="tabular-nums text-slate-500">{won(r.held)}</span>
          </button>
        ))}
      </div>
      {target && <RefundModal target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
