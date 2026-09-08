"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/feeItems";
import { PAYMENT_METHOD_KINDS, needsCashReceipt, type PaymentMethodKind } from "@/lib/payments";

/**
 * 결제완료 체크 창.
 *
 * **수단을 반드시 고르게 합니다.** 자유 글자로 두면 「현금」·「현금납부」·「cash」가 섞이고,
 * 그러면 월말에 세는 일이 다시 사람 손으로 돌아갑니다.
 *
 * **부분 납부는 「얼마」가 아니라 「무엇」으로 받습니다.** 교재비는 냈는데 교복값은 아직인
 * 집이 있고, 그때 담당자가 알아야 하는 것은 남은 금액이 아니라 **남은 항목**입니다.
 * 「7만원 남았습니다」라고 하면 학부모가 무슨 돈인지 되묻고, 그 통화가 그대로 일이 됩니다.
 */

type Line = { id: string; seq: number; name: string; amount: number; paid_payment_id: string | null };

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
  const [paidAt, setPaidAt] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [lines, setLines] = useState<Line[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  /** 이번에 받는 항목. 처음에는 **아직 안 받은 것 전부**입니다(= 전액 수납). */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** 항목이 아니라 금액으로 받는 경우(현금 일부만 들고 오시는 등). */
  const [byAmount, setByAmount] = useState(false);
  const [amount, setAmount] = useState(target.balance);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("invoice_lines")
      .select("id, seq, name, amount, paid_payment_id")
      .eq("invoice_id", target.id)
      .order("seq")
      .then(({ data, error }) => {
        // 못 읽으면 항목 체크 없이 금액으로만 받게 됩니다. 조용히 넘기면 「왜 항목이 안
        // 보이지」가 되므로 이유를 적습니다.
        if (error) {
          setLoadErr(error.message);
          setByAmount(true);
          setLines([]);
          return;
        }
        const rows = (data as Line[]) ?? [];
        setLines(rows);
        setPicked(new Set(rows.filter((l) => !l.paid_payment_id && Number(l.amount) > 0).map((l) => l.id)));
      });
  }, [target.id]);

  const unpaid = (lines ?? []).filter((l) => !l.paid_payment_id);
  const paidLines = (lines ?? []).filter((l) => l.paid_payment_id);
  const pickedTotal = unpaid.filter((l) => picked.has(l.id)).reduce((n, l) => n + Math.round(Number(l.amount)), 0);
  const useLines = !byAmount && unpaid.length > 0;
  const finalAmount = useLines ? pickedTotal : amount;
  const leftAfter = target.balance - finalAmount;

  async function save() {
    if (!method) return setErr("납부 수단을 골라주세요.");
    if (useLines && picked.size === 0) return setErr("받은 항목을 골라주세요.");
    setBusy(true);
    const res = await fetch("/api/finance/invoices/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceId: target.id,
        method,
        paidAt,
        ...(useLines ? { lineIds: [...picked] } : { amount }),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr((body as { error?: string }).error ?? "저장하지 못했습니다.");
    onDone(`${target.label} · ${won(finalAmount)} ${method}으로 받았습니다.`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-bold text-slate-800">결제완료</h3>
        <p className="mb-3 text-[12px] text-slate-500">{target.label}</p>

        {/* ── 무엇을 받았는가 ─────────────────────────────────────────── */}
        {lines === null ? (
          <p className="mb-3 text-[12px] text-slate-400">항목을 읽는 중…</p>
        ) : (
          <>
            {loadErr && (
              <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
                항목을 읽지 못해 금액으로만 받습니다: {loadErr}
              </p>
            )}
            {unpaid.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-slate-500">받은 항목</p>
                  <button
                    onClick={() => setPicked(new Set(unpaid.map((l) => l.id)))}
                    className="rounded border border-slate-300 px-1.5 text-[10px] text-slate-600"
                  >
                    전부
                  </button>
                  <button onClick={() => setPicked(new Set())} className="rounded border border-slate-300 px-1.5 text-[10px] text-slate-600">
                    해제
                  </button>
                  <label className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
                    <input type="checkbox" checked={byAmount} onChange={(e) => setByAmount(e.target.checked)} />
                    항목 대신 금액으로
                  </label>
                </div>
                <ul className={"flex flex-col gap-0.5 " + (byAmount ? "opacity-40" : "")}>
                  {unpaid.map((l) => (
                    <li key={l.id}>
                      <label className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-slate-50">
                        <input
                          type="checkbox"
                          disabled={byAmount}
                          checked={picked.has(l.id)}
                          onChange={(e) =>
                            setPicked((p) => {
                              const n = new Set(p);
                              if (e.target.checked) n.add(l.id);
                              else n.delete(l.id);
                              return n;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-slate-800">{l.name}</span>
                        <span className="tabular-nums text-slate-600">{won(Math.round(Number(l.amount)))}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 이미 받은 항목도 보여줍니다. 「이건 지난번에 냈다」를 화면에서 확인해야
                학부모와 통화하면서 답할 수 있습니다. */}
            {paidLines.length > 0 && (
              <div className="mb-3 rounded-lg bg-emerald-50 px-2 py-1.5">
                <p className="mb-0.5 text-[11px] font-bold text-emerald-800">이미 받은 항목</p>
                <ul className="flex flex-col gap-0.5">
                  {paidLines.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 text-[11px] text-emerald-700">
                      <span className="min-w-0 flex-1 truncate line-through">{l.name}</span>
                      <span className="tabular-nums">{won(Math.round(Number(l.amount)))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

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

        <div className="mb-2 flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500">금액</label>
          {useLines ? (
            <b className="text-[14px] tabular-nums text-slate-800">{won(finalAmount)}</b>
          ) : (
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-right text-[12px] tabular-nums"
            />
          )}
          <span className="text-[11px] text-slate-400">남은 {won(target.balance)}</span>
        </div>
        {/* 받고 나면 무엇이 남는가. 이걸 미리 보여주면 잘못 고른 것을 누르기 전에 압니다. */}
        <p className={"mb-3 text-[11px] " + (leftAfter > 0 ? "font-bold text-amber-700" : "text-emerald-700")}>
          {leftAfter > 0
            ? `이 뒤로 ${won(leftAfter)} 남습니다` +
              (useLines && unpaid.filter((l) => !picked.has(l.id)).length > 0
                ? ` — ${unpaid
                    .filter((l) => !picked.has(l.id))
                    .map((l) => l.name)
                    .join(" · ")}`
                : "")
            : "이 청구서는 완납됩니다"}
        </p>

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
