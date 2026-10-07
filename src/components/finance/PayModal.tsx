"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/feeItems";
import { PAYMENT_METHOD_KINDS, needsCashReceipt, type PaymentMethodKind } from "@/lib/payments";
import { depositBalance, groupLines, isFromDeposit } from "@/lib/depositLines";
import DepositApplyModal from "./DepositApplyModal";

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
  /** 이 학생 앞으로 남은 예치금. 있으면 「예치금에서 빼기」를 먼저 보여줍니다. */
  const [deposit, setDeposit] = useState(0);
  /** 항목별로 예치금이 이미 덮은 금액(일부만 덮인 항목은 나머지만 받습니다). */
  const [fromDep, setFromDep] = useState<Map<string, number>>(new Map());
  const [depOpen, setDepOpen] = useState(false);

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
        setPicked(new Set(groupLines(rows.map((l) => ({ ...l, amount: Number(l.amount) }))).filter((i) => !i.paid).map((i) => i.id)));
      });
    void (async () => {
      const { data: inv } = await supabase.from("invoices").select("student_id").eq("id", target.id).maybeSingle();
      const [onInv, dep] = await Promise.all([
        supabase.from("payments").select("amount, matched_by, applied_line_id").eq("invoice_id", target.id),
        inv?.student_id
          ? supabase.from("payments").select("amount").eq("student_id", inv.student_id).is("invoice_id", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      // 예치금을 못 읽어도 결제는 받을 수 있어야 합니다. 다만 「예치금 없음」으로 보이면 안 되므로
      // 읽은 것만 씁니다(못 읽으면 0으로 두고 단추를 숨깁니다).
      setDeposit(depositBalance(((dep.data as { amount: number | string }[] | null) ?? []).map((x) => ({ amount: Number(x.amount) }))));
      const m = new Map<string, number>();
      for (const p of (onInv.data as { amount: number | string; matched_by: string | null; applied_line_id: string | null }[] | null) ?? []) {
        if (p.applied_line_id && isFromDeposit(p.matched_by)) m.set(p.applied_line_id, (m.get(p.applied_line_id) ?? 0) + Number(p.amount));
      }
      setFromDep(m);
    })();
  }, [target.id]);

  /**
   * 할인 줄은 그 위 항목과 **한 덩어리**입니다(`groupLines`). 줄마다 고르게 두면 「정규과정
   * 4,000,000」만 받고 「└ 할인 −400,000」은 남아, 할인 전 금액을 받게 됩니다.
   */
  const items = groupLines((lines ?? []).map((l) => ({ ...l, amount: Number(l.amount) }))).map((i) => ({
    ...i,
    // 예치금이 일부 덮은 항목은 남은 몫만 받습니다.
    rest: Math.max(0, i.amount - (fromDep.get(i.id) ?? 0)),
  }));
  const unpaid = items.filter((i) => !i.paid);
  const paidLines = items.filter((i) => i.paid);
  const pickedTotal = unpaid.filter((l) => picked.has(l.id)).reduce((n, l) => n + l.rest, 0);
  const useLines = !byAmount && unpaid.length > 0;
  const finalAmount = useLines ? pickedTotal : amount;
  const leftAfter = target.balance - finalAmount;

  async function save(keepExcess = false) {
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
        ...(useLines ? { lineIds: unpaid.filter((i) => picked.has(i.id)).flatMap((i) => i.members) } : { amount }),
        keepExcess,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; excess?: number; balance?: number };
    setBusy(false);
    // 청구액보다 많이 적었을 때. 거절하지 않고 **넘는 돈을 예치금으로 둘지** 묻습니다 -
    // 두 번 낸 집, 큰 돈을 미리 낸 집이 실제로 있고, 그 돈은 다음 청구에서 깎아야 합니다.
    // 창은 서버가 센 금액을 그대로 보여줍니다. 여기서 다시 계산하면 두 숫자가 어긋납니다.
    if (res.status === 409 && typeof body.excess === "number" && body.excess > 0) {
      const ok = confirm(
        `이 청구서의 남은 금액은 ${won(body.balance ?? 0)}입니다.\n` +
          `넘는 ${won(body.excess)}을 이 학생의 예치금으로 두고, 다음 청구서에서 깎을까요?\n\n` +
          `(돌려드려야 하는 돈이면 「취소」하고 환불로 처리해주세요.)`,
      );
      if (!ok) return;
      return save(true);
    }
    if (!res.ok) return setErr(body.error ?? "저장하지 못했습니다.");
    const ex = typeof body.excess === "number" && body.excess > 0 ? ` · 넘는 ${won(body.excess)}은 예치금으로` : "";
    onDone(`${target.label} · ${won(Math.min(finalAmount, target.balance))} ${method}으로 받았습니다.${ex}`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-bold text-slate-800">받은 돈 적기</h3>
        <p className="mb-3 text-[12px] text-slate-500">{target.label}</p>

        {/* 예치금이 있으면 맨 위에 둡니다. 이미 맡겨둔 돈이 있는데 새 돈을 받으면 학부모가 두 번 냅니다. */}
        {(deposit > 0 || fromDep.size > 0) && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-teal-50 px-2.5 py-1.5 text-[12px] text-teal-900">
            <span className="min-w-0 flex-1">
              남은 예치금 <b className="tabular-nums">{won(deposit)}</b>
              {fromDep.size > 0 && <span className="ml-1 text-[11px] text-teal-700">· 이 청구서에서 이미 {won([...fromDep.values()].reduce((n, v) => n + v, 0))} 뺌</span>}
            </span>
            <button onClick={() => setDepOpen(true)} className="shrink-0 rounded bg-teal-600 px-2 py-1 text-[11px] font-bold text-white">
              예치금에서 빼기
            </button>
          </div>
        )}

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
                        <span className="min-w-0 flex-1 truncate text-slate-800">
                          {l.name}
                          {l.rest < l.amount && <span className="ml-1 text-[10px] text-teal-700">예치금 {won(l.amount - l.rest)} 차감</span>}
                        </span>
                        <span className="tabular-nums text-slate-600">{won(l.rest)}</span>
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
                      <span className="tabular-nums">{won(l.amount)}</span>
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
            : leftAfter < 0
              ? `이 청구서는 완납되고, 넘는 ${won(-leftAfter)}은 예치금으로 둡니다(다음 청구서에서 깎임)`
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
      {depOpen && (
        <DepositApplyModal
          invoiceId={target.id}
          label={target.label}
          onClose={() => setDepOpen(false)}
          onDone={(msg) => {
            // 예치금을 빼면 남은 금액이 바뀝니다. 옛 금액을 든 채 결제를 받지 않도록 이 창도 닫습니다.
            onDone(msg);
            onClose();
          }}
        />
      )}
    </div>
  );
}
