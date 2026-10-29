"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";

export type MismatchRow = { id: string; invoiceNo: string; name: string; issueDate: string; amount: number; stream: string };

/**
 * **발행한 달과 청구월이 다른 청구서** — 이 달 화면 위에 모아 보이고, 고른 것을 발행한 달로 옮깁니다.
 *
 * 재무 화면의 달은 쿠키에 남습니다. 다음 달을 한 번 열어 본 뒤 발행하면 이번 달 청구서가 다음 달분으로 찍히고,
 * 다음 달 칸이 «청구됨»으로 잠겨 그 달 청구를 못 합니다. 미리 다음 달 것을 낸 경우도 있어 저절로 옮기지 않고,
 * 사람이 고른 것만 옮깁니다. 금액·번호는 그대로이고 «몇 월분»만 바뀝니다(내력: `invoice_billing_month_log`).
 */
export default function BillingMonthFix({ month, rows }: { month: string; rows: MismatchRow[] }) {
  const notify = useToast();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const byIssue = useMemo(() => {
    const m = new Map<string, MismatchRow[]>();
    for (const r of rows) m.set(r.issueDate.slice(0, 7), [...(m.get(r.issueDate.slice(0, 7)) ?? []), r]);
    return [...m.entries()].sort();
  }, [rows]);
  if (rows.length === 0) return null;
  const label = (m: string) => `${Number(m.slice(5))}월`;

  async function move(target: string, ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length}장을 ${label(target)}분으로 옮깁니다. 금액·번호는 그대로입니다.`)) return;
    setBusy(true);
    const res = await fetch("/api/finance/invoices/billing-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceIds: ids, month: target, reason: `${label(month)}분으로 찍힌 ${label(target)} 발행분을 ${label(target)}분으로` }),
    });
    const b = (await res.json().catch(() => ({}))) as { moved?: number; skipped?: string[]; error?: string };
    setBusy(false);
    if (!res.ok) return notify(b.error ?? "옮기지 못했습니다.", "error");
    notify(`${b.moved ?? 0}장을 ${label(target)}분으로 옮겼습니다.`, "success");
    if (b.skipped?.length) notify(`옮기지 않음: ${b.skipped.join(", ")}`, "error");
    setPicked(new Set());
    router.refresh();
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-amber-900">
          ⚠ 다른 달에 발행했는데 {label(month)}분으로 찍힌 청구서 {rows.length}장
        </b>
        <span className="text-amber-800">— 화면의 달이 {label(month)}에 머문 채 발행했을 수 있습니다. 맞는 달로 옮기면 그 달 칸이 다시 열립니다.</span>
        <button onClick={() => setOpen((v) => !v)} className="ml-auto rounded px-2 py-0.5 font-bold text-amber-900 hover:bg-amber-100">
          {open ? "접기 ▴" : "보기 ▾"}
        </button>
      </div>
      {open &&
        byIssue.map(([issueMonth, list]) => {
          const ids = list.filter((r) => picked.has(r.id)).map((r) => r.id);
          return (
            <div key={issueMonth} className="mt-2 rounded border border-amber-200 bg-white p-2">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <b>{label(issueMonth)}에 발행 · {list.length}장</b>
                <button
                  onClick={() => setPicked((p) => { const n = new Set(p); const all = list.every((r) => n.has(r.id)); for (const r of list) { if (all) n.delete(r.id); else n.add(r.id); } return n; })}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600"
                >
                  모두 고르기/풀기
                </button>
                <button
                  disabled={busy || ids.length === 0}
                  onClick={() => void move(issueMonth, ids)}
                  className="ml-auto whitespace-nowrap rounded bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-40"
                >
                  고른 {ids.length}장 → {label(issueMonth)}분으로 옮기기
                </button>
              </div>
              <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                {list.map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-amber-50">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                    <span className="whitespace-nowrap tabular-nums text-slate-500">{r.invoiceNo}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                    <span className="whitespace-nowrap text-[11px] text-slate-500">{r.stream} · {r.issueDate.slice(5).replace("-", "/")}</span>
                    <span className="whitespace-nowrap tabular-nums font-bold">{won(r.amount)}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}
