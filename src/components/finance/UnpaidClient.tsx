"use client";

import { useMemo, useState } from "react";
import { useFinanceLive } from "@/lib/useFinanceLive";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { Who } from "@/components/common/HomonymProvider";
import AlltalkpayExport from "./AlltalkpayExport";
import {
  buildUnpaidLedger,
  mergeWarning,
  AGING_ORDER,
  BIG_INVOICE_WON,
  type AgingBucket,
  type UnpaidInvoice,
  type UnpaidPayment,
  type UnpaidRow,
} from "@/lib/unpaidLedger";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

const AGING_TONE: Record<AgingBucket, string> = {
  "90일 초과": "bg-rose-100 text-rose-800",
  "61~90일": "bg-orange-100 text-orange-800",
  "31~60일": "bg-amber-100 text-amber-800",
  "1~30일": "bg-yellow-100 text-yellow-800",
  "기한 전": "bg-slate-100 text-slate-500",
};

/**
 * **미납금 관리.**
 *
 * 여기서 하는 일은 둘뿐입니다 - 그리고 **어느 쪽을 고를지가 돈이 걷히느냐를 가릅니다.**
 *
 *   · **따로 다시 보내기** — 원 청구서를 그대로 다시 보냅니다. 금액이 작고 무슨 돈인지
 *     학부모가 알아봅니다. 8~9월 실측에서 30만 이하가 57.8% 로 가장 잘 걷혔습니다.
 *   · **합쳐서 한 장** — 정말 정리해야 할 때만. 100만원을 넘으면 화면이 말리고,
 *     200만원을 넘으면 강하게 말립니다(그 구간은 수납률이 0% 였습니다).
 */
export default function UnpaidClient({
  invoices,
  payments,
  students,
  today,
  loadError,
}: {
  invoices: UnpaidInvoice[];
  payments: UnpaidPayment[];
  students: { id: string; name: string; grade: string | null; class_name: string | null }[];
  today: string;
  loadError: string | null;
}) {
  // 돈에 닿는 자료가 바뀌면 이 화면이 함께 다시 그려집니다. 한 사람이 고치고
  // 여러 사람이 보는 화면이라, 고친 사람만 새 금액을 보면 안 됩니다.
  useFinanceLive(["wr_students"]);
  const notify = useToast();
  const confirmAction = useConfirm();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [bucket, setBucket] = useState<AgingBucket | "전체">("전체");

  const whereById = useMemo(
    () => new Map(students.map((s) => [s.id, [s.grade, s.class_name].filter(Boolean).join(" ")])),
    [students],
  );
  const nameById = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);

  const ledger = useMemo(
    () => buildUnpaidLedger(invoices, payments, { today, nameOf: (id) => nameById.get(id) ?? null }),
    [invoices, payments, today, nameById],
  );

  const rowById = useMemo(() => {
    const m = new Map<string, UnpaidRow>();
    for (const g of ledger.groups) for (const r of g.rows) m.set(r.invoice.id, r);
    for (const r of ledger.orphans) m.set(r.invoice.id, r);
    return m;
  }, [ledger]);

  const pickedRows = useMemo(() => [...picked].map((id) => rowById.get(id)).filter((r): r is UnpaidRow => !!r), [picked, rowById]);
  const pickedTotal = pickedRows.reduce((n, r) => n + r.balance, 0);
  const warn = mergeWarning(pickedRows);
  /** 고른 것이 한 학생인가. 섞이면 합칠 수 없습니다 - 남의 돈이 청구됩니다. */
  const onePerson = new Set(pickedRows.map((r) => r.invoice.student_id)).size === 1;

  const visible = bucket === "전체" ? ledger.groups : ledger.groups.filter((g) => g.rows.some((r) => r.aging === bucket));

  /** 구간별 합계. 「어디에 얼마가 묶여 있나」가 한 줄로 보여야 다음 행동이 정해집니다. */
  const byBucket = useMemo(() => {
    const m = new Map<AgingBucket, { count: number; sum: number }>();
    for (const g of ledger.groups) {
      for (const r of g.rows) {
        const cur = m.get(r.aging) ?? { count: 0, sum: 0 };
        m.set(r.aging, { count: cur.count + 1, sum: cur.sum + r.balance });
      }
    }
    return m;
  }, [ledger]);

  function toggle(id: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickAllOf(rows: UnpaidRow[]) {
    setPicked((p) => {
      const next = new Set(p);
      // 이미 다 골랐으면 해제, 아니면 전부 고릅니다. 한 단추가 두 가지 일을 하는 것이
      // 맞습니다 - 고르기와 해제를 따로 두면 단추가 두 개가 되고, 어느 쪽인지 매번 봅니다.
      const all = rows.every((r) => next.has(r.invoice.id));
      for (const r of rows) {
        if (all) next.delete(r.invoice.id);
        else next.add(r.invoice.id);
      }
      return next;
    });
  }

  async function merge() {
    if (pickedRows.length < 2) {
      notify("합칠 청구서를 두 건 이상 골라주세요.", "error");
      return;
    }
    if (!onePerson) {
      notify("한 학생의 청구서끼리만 합칠 수 있습니다.", "error");
      return;
    }
    const ok = await confirmAction(
      `${pickedRows.length}건을 ${won(pickedTotal)} 짜리 한 장으로 합칩니다.\n` +
        `원 청구서는 「이월됨」으로 잠기고, 학부모에게는 새 번호로 한 장이 갑니다.` +
        (warn ? `\n\n⚠️ ${warn.replace(/\*\*/g, "")}` : ""),
      { danger: !!warn },
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/finance/unpaid/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceIds: [...picked] }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; invoice?: { invoice_no: string } } | null;
    setBusy(false);
    // 조용히 넘기면 합쳐진 줄 알고 또 합칩니다. 그러면 같은 돈이 두 장에 남습니다.
    if (!res.ok) {
      notify(json?.error ?? "합치지 못했습니다.", "error");
      return;
    }
    notify(`${json?.invoice?.invoice_no} 한 장으로 합쳤습니다. 이제 올톡페이로 보내세요.`, "success");
    setPicked(new Set());
    router.refresh();
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">🧾 미납금</h1>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
          {ledger.groups.length}명 · {won(ledger.total)}
        </span>
        <Link href="/finance/monthly" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          월별 →
        </Link>
      </div>

      <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
        미납은 이제 <b>새 청구서에 저절로 얹히지 않습니다.</b> 여기서 무엇을 어떻게 다시 보낼지 고릅니다.
        <br />
        <b>따로 다시 보내기</b>가 기본입니다 — 8~9월 실측에서 30만원 이하가 <b>57.8%</b> 로 가장 잘 걷혔고,
        <b className="text-rose-700"> 200만원을 넘긴 청구서는 한 건도 안 걷혔습니다</b>(7건 3,190만원).
        합치면 금액이 커지고 학부모는 무슨 돈인지 모릅니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}

      {/* 연체 구간 — 「어디에 얼마가 묶여 있나」. 90일 넘은 돈은 재발송으로 안 걷힙니다. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setBucket("전체")}
          className={"rounded-full px-2.5 py-1 text-[11px] font-bold " + (bucket === "전체" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
        >
          전체 {ledger.groups.length}명
        </button>
        {AGING_ORDER.map((b) => {
          const v = byBucket.get(b);
          if (!v) return null;
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(bucket === b ? "전체" : b)}
              className={"rounded-full px-2.5 py-1 text-[11px] font-bold " + (bucket === b ? "bg-slate-800 text-white" : AGING_TONE[b])}
            >
              {b} {v.count}건 · {won(v.sum)}
            </button>
          );
        })}
      </div>

      {/* 고른 것에 대한 행동 줄. 고르기 전에는 안 보입니다 - 늘 떠 있으면 자리만 차지합니다. */}
      {picked.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 rounded-xl border-2 border-teal-300 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[12px] text-slate-800">
              {picked.size}건 고름 · {won(pickedTotal)}
            </b>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSending([...picked])}
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:bg-slate-300"
            >
              📤 따로 다시 보내기 ({picked.size}장)
            </button>
            <button
              type="button"
              disabled={busy || picked.size < 2 || !onePerson}
              onClick={() => void merge()}
              title={!onePerson ? "한 학생의 청구서끼리만 합칠 수 있습니다" : undefined}
              className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-300 disabled:ring-slate-200"
            >
              🧾 합쳐서 한 장
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className="ml-auto text-[11px] text-slate-400 hover:text-slate-700">
              고르기 해제
            </button>
          </div>
          {warn && (
            <p className={"mt-1.5 text-[11px] font-semibold " + (pickedTotal > 2_000_000 ? "text-rose-700" : "text-amber-700")}>
              ⚠️ {warn.replace(/\*\*/g, "")}
            </p>
          )}
          {!onePerson && picked.size > 1 && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              학생이 섞여 있어 합치기는 못 합니다. 따로 보내는 것은 됩니다.
            </p>
          )}
        </div>
      )}

      {/* 가둔 화면 안쪽에서 굴립니다(CLAUDE.md 2-10). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ledger.orphans.length > 0 && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50/50 p-3">
            <p className="mb-1 text-[12px] font-bold text-rose-800">
              학생이 안 이어진 청구서 {ledger.orphans.length}건 · {won(ledger.orphans.reduce((n, r) => n + r.balance, 0))}
            </p>
            <p className="text-[11px] text-rose-700">
              누구 것인지 모르는 청구입니다. 합치거나 다시 보낼 수 없습니다 — 청구 화면에서 학생을 먼저 이어주세요.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {ledger.orphans.map((r) => (
                <span key={r.invoice.id} className="rounded bg-white px-1.5 py-0.5 text-[11px] ring-1 ring-rose-200">
                  {r.invoice.invoice_no} · {r.invoice.student_name} · {won(r.balance)}
                </span>
              ))}
            </div>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">
            {ledger.groups.length === 0 ? "미납이 없습니다." : "그 구간에 해당하는 미납이 없습니다."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((g) => (
              <div
                key={g.studentId}
                className={"rounded-xl border p-3 " + (g.tooBig ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white")}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => pickAllOf(g.rows)}
                    className="rounded px-1 text-[11px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="이 학생의 미납을 모두 고르기"
                  >
                    ☑
                  </button>
                  <b className="text-[13px] text-slate-800">
                    <Who id={g.studentId} name={g.label} />
                  </b>
                  <span className="text-[10px] text-slate-400">{whereById.get(g.studentId) || ""}</span>
                  <span className={"rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums " + (g.tooBig ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700")}>
                    {won(g.total)}
                  </span>
                  <span className={"rounded px-1 py-0.5 text-[9px] font-bold " + AGING_TONE[g.worst]}>{g.worst}</span>
                  {g.tooBig && (
                    <span className="text-[10px] font-semibold text-rose-700">
                      합계가 {won(BIG_INVOICE_WON)} 을 넘습니다 — 합치지 말고 따로 보내세요
                    </span>
                  )}
                  <Link href={`/finance/statement/${g.studentId}`} className="ml-auto text-[10px] font-semibold text-teal-700 underline">
                    거래명세서
                  </Link>
                </div>

                <div className="flex flex-col gap-1">
                  {g.rows.map((r) => (
                    <label
                      key={r.invoice.id}
                      className={
                        "flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-[12px] " +
                        (picked.has(r.invoice.id) ? "bg-teal-50 ring-1 ring-teal-300" : "bg-slate-50 hover:bg-slate-100")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(r.invoice.id)}
                        onChange={() => toggle(r.invoice.id)}
                        className="h-3.5 w-3.5 accent-teal-600"
                      />
                      <span className="font-mono text-[11px] text-slate-500">{r.invoice.invoice_no}</span>
                      <span className="rounded bg-white px-1 py-0.5 text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">{r.stream}</span>
                      <b className="tabular-nums text-slate-800">{won(r.balance)}</b>
                      {r.paid > 0 && <span className="text-[10px] text-emerald-700">({won(r.paid)} 받음)</span>}
                      <span className="text-[10px] text-slate-400">마감 {r.invoice.due_date}</span>
                      <span className={"rounded px-1 py-0.5 text-[9px] font-bold " + AGING_TONE[r.aging]}>
                        {r.days > 0 ? `${r.days}일 지남` : "기한 전"}
                      </span>
                      {/* 이미 보낸 건지가 보여야 두 번 안 보냅니다. */}
                      {r.invoice.exported_at && (
                        <span className="text-[9px] text-slate-400" title="올톡페이로 내보낸 적이 있습니다">
                          보낸 적 있음
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sending && <AlltalkpayExport invoiceIds={sending} onClose={() => setSending(null)} onMarked={() => router.refresh()} />}
    </div>
  );
}
