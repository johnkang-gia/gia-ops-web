"use client";

import { useState } from "react";
import { won } from "@/lib/feeItems";
import { PAYMENT_METHOD_KINDS, needsCashReceipt, type PaymentMethodKind } from "@/lib/payments";

/**
 * 결제완료 체크 창.
 *
 * **수단을 반드시 고르게 합니다.** 자유 글자로 두면 「현금」·「현금납부」·「cash」가 섞이고,
 * 그러면 월말에 세는 일이 다시 사람 손으로 돌아갑니다. 금액은 기본이 남은 전액이고, 부분
 * 납부는 고쳐서 넣습니다 - 실제로 반만 내고 나머지는 다음 달에 내는 집이 있습니다.
 */
export default function PayModal({
  target,
  today,
  onClose,
  onDone,
}: {
  target: { id: string; label: string; balance: number };
  today: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [method, setMethod] = useState<PaymentMethodKind | "">("");
  const [amount, setAmount] = useState(target.balance);
  const [paidAt, setPaidAt] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!method) return setErr("납부 수단을 골라주세요.");
    setBusy(true);
    const res = await fetch("/api/finance/invoices/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: target.id, method, amount, paidAt }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr((body as { error?: string }).error ?? "저장하지 못했습니다.");
    onDone(`${target.label} · ${won(amount)} ${method}으로 받았습니다.`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-bold text-slate-800">결제완료</h3>
        <p className="mb-3 text-[12px] text-slate-500">{target.label}</p>

        <p className="mb-1 text-[11px] font-semibold text-slate-500">납부 수단</p>
        <div className="mb-3 flex flex-wrap gap-1">
          {PAYMENT_METHOD_KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setMethod(k)}
              className={
                "rounded-lg px-2.5 py-1 text-[12px] font-semibold " +
                (method === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")
              }
            >
              {k}
            </button>
          ))}
        </div>
        {needsCashReceipt(method) && (
          <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            현금·계좌이체는 <b>현금영수증</b>을 따로 발행해야 합니다. 재무 → 수납 → 현금영수증에서 신청을 받으세요.
          </p>
        )}

        <div className="mb-3 flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500">금액</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-right text-[12px] tabular-nums"
          />
          <span className="text-[11px] text-slate-400">남은 {won(target.balance)}</span>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500">받은 날</label>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
        </div>

        {err && <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">{err}</p>}
        <button
          onClick={() => void save()}
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 py-2 text-[13px] font-bold text-white disabled:opacity-40"
        >
          {busy ? "저장 중…" : "받았습니다"}
        </button>
      </div>
    </div>
  );
}

