"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/feeItems";
import { depositBalance, groupLines, isFromDeposit, type LineItem } from "@/lib/depositLines";

/**
 * **예치금에서 뺄 항목 고르기.**
 *
 * 예치금은 금액이 아니라 **항목으로** 뺍니다. 학부모에게 가는 청구서·영수증에 「교복은
 * 예치금에서」라고 적혀야, 남은 돈이 무엇인지 되묻지 않습니다.
 *
 * 체크한 것이 곧 이 청구서의 예치금 차감 전부입니다 - 체크를 풀고 저장하면 그 항목 몫은
 * 예치금으로 돌아갑니다. 숫자는 저장한 뒤 서버가 다시 셉니다. 여기서 보이는 「남는 예치금」은
 * 누르기 전에 판단하라고 보여주는 값입니다.
 */

type Line = { id: string; seq: number; name: string; amount: number; paid_payment_id: string | null };
type Pay = { id: string; amount: number; matched_by: string | null; applied_line_id: string | null };

export default function DepositApplyModal({
  invoiceId,
  label,
  onClose,
  onDone,
}: {
  invoiceId: string;
  label: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [pays, setPays] = useState<Pay[]>([]);
  const [balance, setBalance] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 고른 순서가 곧 덮는 순서입니다. 모자라면 마지막에 고른 항목이 일부만 덮입니다. */
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: inv, error: invErr } = await supabase.from("invoices").select("student_id").eq("id", invoiceId).maybeSingle();
      if (invErr || !inv?.student_id) return setErr(invErr?.message ?? "학생이 이어지지 않은 청구서입니다.");
      const [l, p, d] = await Promise.all([
        supabase.from("invoice_lines").select("id, seq, name, amount, paid_payment_id").eq("invoice_id", invoiceId).order("seq"),
        supabase.from("payments").select("id, amount, matched_by, applied_line_id").eq("invoice_id", invoiceId),
        supabase.from("payments").select("amount").eq("student_id", inv.student_id).is("invoice_id", null),
      ]);
      // 못 읽은 채로 고르게 하면 이미 뺀 항목을 모르고 다시 빼게 됩니다. 이유를 띄우고 멈춥니다.
      const bad = l.error ?? p.error ?? d.error;
      if (bad) return setErr(bad.message);
      const ls = ((l.data as Line[] | null) ?? []).map((x) => ({ ...x, amount: Number(x.amount) }));
      const ps = ((p.data as Pay[] | null) ?? []).map((x) => ({ ...x, amount: Number(x.amount) }));
      setLines(ls);
      setPays(ps);
      setBalance(depositBalance(((d.data as { amount: number | string }[] | null) ?? []).map((x) => ({ amount: Number(x.amount) }))));
      const dep = ps.filter((x) => isFromDeposit(x.matched_by) && x.applied_line_id);
      setOrder([...new Set(dep.map((x) => x.applied_line_id as string))]);
    })();
  }, [invoiceId]);

  const depPays = pays.filter((p) => isFromDeposit(p.matched_by));
  const depIds = new Set(depPays.map((p) => p.id));
  const onInvoice = depPays.reduce((n, p) => n + p.amount, 0);
  /** 이 청구서에서 예치금을 되돌린 뒤 쓸 수 있는 돈. */
  const available = balance + onInvoice;

  const items: (LineItem & { now: number; lockedBy: boolean })[] = useMemo(() => {
    if (!lines) return [];
    const byId = new Map(lines.map((l) => [l.id, l]));
    return groupLines(lines).map((i) => ({
      ...i,
      now: depPays.filter((p) => p.applied_line_id === i.id).reduce((n, p) => n + p.amount, 0),
      // 다른 돈(입금·이미 받음)으로 받은 항목은 예치금으로 뺄 수 없습니다 - 두 번 받게 됩니다.
      lockedBy: i.members.some((m) => {
        const pid = byId.get(m)?.paid_payment_id;
        return !!pid && !depIds.has(pid);
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, pays]);

  const picked = order.map((id) => items.find((i) => i.id === id)).filter((i): i is (typeof items)[number] => !!i && !i.lockedBy);
  const need = picked.reduce((n, i) => n + i.amount, 0);
  const willApply = Math.min(need, available);
  const short = need > available ? picked[picked.length - 1] : null;
  const shortCovered = short ? short.amount - (need - available) : 0;

  function toggle(id: string, on: boolean) {
    setOrder((o) => (on ? [...o.filter((x) => x !== id), id] : o.filter((x) => x !== id)));
  }

  async function save(allowPartial = false) {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/finance/invoices/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId, lineIds: picked.map((i) => i.id), allowPartial }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      applied?: number;
      released?: number;
      left?: number;
      partial?: { name: string; covered: number; need: number } | null;
    };
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "저장하지 못했습니다.");
    const names = picked.map((i) => i.name).join(" · ");
    onDone(
      (body.applied ?? 0) > 0
        ? `${label} · 예치금에서 ${won(body.applied ?? 0)} 차감(${names})${body.partial ? ` — ${body.partial.name}은 ${won(body.partial.covered)}만` : ""} · 남은 예치금 ${won(body.left ?? 0)}`
        : `${label} · 예치금 차감을 모두 되돌렸습니다(${won(body.released ?? 0)}).`,
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-bold text-slate-800">예치금에서 빼기</h3>
        <p className="mb-3 text-[12px] text-slate-500">{label}</p>

        {err && <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">{err}</p>}
        {!lines && !err && <p className="text-[12px] text-slate-400">읽는 중…</p>}

        {lines && (
          <>
            <div className="mb-3 rounded-lg bg-teal-50 px-3 py-2 text-[12px] text-teal-900">
              쓸 수 있는 예치금 <b className="tabular-nums">{won(available)}</b>
              {onInvoice > 0 && <span className="ml-1 text-[11px] text-teal-700">(이 청구서에서 이미 뺀 {won(onInvoice)} 포함)</span>}
            </div>

            <p className="mb-1 text-[11px] font-semibold text-slate-500">예치금에서 낼 항목 — 고른 순서대로 뺍니다</p>
            <ul className="mb-3 flex flex-col gap-0.5">
              {items.map((i) => {
                const on = order.includes(i.id);
                const rank = picked.findIndex((p) => p.id === i.id);
                return (
                  <li key={i.id}>
                    <label className={"flex items-center gap-2 rounded px-1 py-1 text-[12px] " + (i.lockedBy ? "opacity-50" : "hover:bg-slate-50")}>
                      <input type="checkbox" disabled={i.lockedBy || busy} checked={on && !i.lockedBy} onChange={(e) => toggle(i.id, e.target.checked)} />
                      {rank >= 0 && <span className="w-4 text-center text-[10px] font-bold text-teal-700">{rank + 1}</span>}
                      <span className="min-w-0 flex-1 text-slate-800">
                        {i.name.replace(/^[\s　└]+/, "")}
                        {i.members.length > 1 && <span className="ml-1 text-[10px] text-slate-400">할인 반영</span>}
                        {i.lockedBy && <span className="ml-1 text-[10px] text-emerald-700">다른 돈으로 받음</span>}
                        {!i.lockedBy && i.now > 0 && <span className="ml-1 text-[10px] text-teal-700">지금 예치금 {won(i.now)}</span>}
                      </span>
                      <span className="tabular-nums text-slate-600">{won(i.amount)}</span>
                    </label>
                  </li>
                );
              })}
              {items.length === 0 && <li className="text-[11px] text-slate-400">뺄 수 있는 항목이 없습니다.</li>}
            </ul>

            <div className="mb-3 space-y-0.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px]">
              <div className="flex justify-between"><span className="text-slate-500">예치금에서 뺄 금액</span><b className="tabular-nums">{won(willApply)}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">빼고 남는 예치금</span><b className="tabular-nums text-teal-700">{won(available - willApply)}</b></div>
            </div>
            {short && (
              <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                예치금이 {won(need - available)} 모자랍니다. 마지막에 고른 「{short.name.replace(/^[\s　└]+/, "")}」은 {won(shortCovered)}만 예치금에서 빠지고, 나머지
                {" "}{won(short.amount - shortCovered)}은 청구서에 남습니다.
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-[12px] font-bold text-slate-600">닫기</button>
              <button
                onClick={() => void save(!!short)}
                disabled={busy || (picked.length === 0 && onInvoice === 0)}
                className="flex-1 rounded-lg bg-teal-600 py-2 text-[13px] font-bold text-white disabled:opacity-40"
              >
                {busy ? "저장 중…" : picked.length === 0 ? "예치금 차감 모두 되돌리기" : short ? "일부만 빼고 저장" : `예치금에서 ${won(willApply)} 빼기`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
