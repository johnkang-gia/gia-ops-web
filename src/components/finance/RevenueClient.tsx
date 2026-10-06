"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { rollUp, treeOrder, type AccountRow, type AccountTotals } from "@/lib/revenueAccounts";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

function shift(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = y * 12 + (mo - 1) + by;
  return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, "0")}`;
}

export default function RevenueClient({
  accounts,
  rows,
  unresolved,
  from,
  to,
  thisMonth,
  loadError,
}: {
  accounts: AccountRow[];
  rows: AccountTotals[];
  unresolved: number;
  from: string;
  to: string;
  thisMonth: string;
  loadError: string | null;
}) {
  useFinanceLive();
  const router = useRouter();
  const tree = useMemo(() => treeOrder(accounts), [accounts]);
  const rolled = useMemo(() => rollUp(accounts, rows), [accounts, rows]);
  const unmapped = rows.find((r) => r.accountId === null);
  // 합계는 맨 위 줄(관)들을 더한 값과 미분류를 더합니다. 목을 다시 더하면 관 합계와 어긋날 수 있습니다.
  const total = useMemo(() => {
    const t = { billed: 0, received: 0, writtenOff: 0, due: 0 };
    for (const r of rows) {
      t.billed += r.billed;
      t.received += r.received;
      t.writtenOff += r.writtenOff;
      t.due += r.due;
    }
    return t;
  }, [rows]);

  const go = (f: string, t: string) => router.push(`/finance/revenue?from=${f}&to=${t}`);
  const year = thisMonth.slice(0, 4);

  function copy() {
    const lines = [["코드", "과목", "구분", "부과", "수납", "결손", "미수"].join("\t")];
    for (const a of tree) {
      const r = rolled.get(a.id);
      if (!r) continue;
      lines.push([a.code, a.name, a.level, r.billed, r.received, r.writtenOff, r.due].join("\t"));
    }
    if (unmapped) lines.push(["", "미분류", "", unmapped.billed, unmapped.received, unmapped.writtenOff, unmapped.due].join("\t"));
    void navigator.clipboard.writeText(lines.join("\n"));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-[16px] font-black text-slate-800">📊 과목별 수입현황</h1>
        <span className="text-[11px] text-slate-500">청구월 기준 · 수납과 결손은 청구서 안에서 줄 금액 비율로 나눕니다</span>
        <div className="ml-auto flex flex-wrap items-center gap-1 text-[12px]">
          <input type="month" defaultValue={from} onChange={(e) => e.target.value && go(e.target.value, to)} className="rounded border border-slate-200 px-1.5 py-0.5" />
          <span>~</span>
          <input type="month" defaultValue={to} onChange={(e) => e.target.value && go(from, e.target.value)} className="rounded border border-slate-200 px-1.5 py-0.5" />
          <button onClick={() => go(thisMonth, thisMonth)} className="rounded bg-slate-100 px-2 py-0.5 font-semibold hover:bg-slate-200">이번 달</button>
          <button onClick={() => go(shift(thisMonth, -2), thisMonth)} className="rounded bg-slate-100 px-2 py-0.5 font-semibold hover:bg-slate-200">최근 3개월</button>
          <button onClick={() => go(`${year}-01`, `${year}-12`)} className="rounded bg-slate-100 px-2 py-0.5 font-semibold hover:bg-slate-200">{year}년</button>
          <button onClick={copy} className="rounded bg-slate-800 px-2 py-0.5 font-semibold text-white hover:bg-slate-900" title="엑셀에 붙여넣을 수 있게 복사">복사</button>
        </div>
      </div>

      {loadError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{loadError}</p>}
      {unresolved !== 0 && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          과목이 정해지지 않아 <b>이름으로 짐작</b>한 금액이 {won(unresolved)}원 있습니다. 항목·분류에 과목을 정하면{" "}
          <Link href="/finance/accounts" className="font-bold underline">
            [세입과목]
          </Link>{" "}
          짐작이 사라집니다.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left">과목</th>
              <th className="px-2 py-1.5 text-right">부과</th>
              <th className="px-2 py-1.5 text-right">수납</th>
              <th className="px-2 py-1.5 text-right">결손</th>
              <th className="px-2 py-1.5 text-right">미수</th>
              <th className="px-2 py-1.5 text-right">수납률</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((a) => {
              const r = rolled.get(a.id);
              if (!r && a.level === "목") return null;
              const z = r ?? { billed: 0, received: 0, writtenOff: 0, due: 0, guessed: 0 };
              const rate = z.billed > 0 ? Math.round((z.received / z.billed) * 100) : null;
              return (
                <tr key={a.id} className={"border-t border-slate-100 " + (a.level === "관" ? "bg-slate-50 font-black" : a.level === "항" ? "font-bold" : "")}>
                  <td className="px-2 py-1" style={{ paddingLeft: 8 + a.depth * 16 }}>
                    <span className="mr-1 text-[10px] text-slate-400">{a.code}</span>
                    {a.name}
                    {z.guessed !== 0 && a.level === "목" && <span className="ml-1 text-[10px] font-normal text-amber-600">짐작 {won(z.guessed)}</span>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{won(z.billed)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{won(z.received)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-violet-700">{z.writtenOff ? won(z.writtenOff) : ""}</td>
                  <td className={"px-2 py-1 text-right tabular-nums " + (z.due > 0 ? "text-rose-600" : "text-slate-500")}>{won(z.due)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-500">{rate === null ? "" : `${rate}%`}</td>
                </tr>
              );
            })}
            {unmapped && (
              <tr className="border-t border-slate-100 text-amber-800">
                <td className="px-2 py-1">미분류</td>
                <td className="px-2 py-1 text-right tabular-nums">{won(unmapped.billed)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{won(unmapped.received)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{unmapped.writtenOff ? won(unmapped.writtenOff) : ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">{won(unmapped.due)}</td>
                <td />
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-800 text-white">
            <tr className="font-black">
              <td className="px-2 py-1.5">합계 ({from} ~ {to})</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{won(total.billed)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{won(total.received)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{won(total.writtenOff)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{won(total.due)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{total.billed > 0 ? `${Math.round((total.received / total.billed) * 100)}%` : ""}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
