"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import { shiftMonth, type MonthKey } from "@/lib/financePeriod";

/**
 * **「+ 추가」 — 이 아이에게만 받는 돈 한 줄.**
 *
 * ── 왜 항목이 아니라 줄인가 ──────────────────────────────────────────────
 *
 * 셔틀비를 한 명에게만 받거나 오케스트라 추가금을 두 달만 받는 일이 생깁니다. 그때마다 납부 항목을 만들면
 * 요금표가 한 명짜리 항목으로 늘고, 다음 학기에 아무도 못 지웁니다. 그래서 «제목·금액·언제»만 적는 줄을
 * 두고, 다음에 발행하는 학비 청구서에 한 줄로 붙입니다(`tuition_extra_charges`). 차액(± 더·덜 받기)과 같은
 * 표입니다 - 청구서에 붙는 방식이 같기 때문입니다.
 *
 * ── 매달이면 달마다 줄 하나 ──────────────────────────────────────────────
 *
 * 「11월부터 2월까지 매달 5만 원」은 줄 넷으로 풀어 넣습니다(같은 `series_id`). 한 줄에 기간만 적어 두면
 * «어느 달까지 얹혔나»를 따로 세어야 하고, 그 계산이 두 화면에서 다르면 두 번 청구됩니다. 줄마다 `invoice_id`
 * 가 붙으니 얹힌 달·안 얹힌 달이 그대로 보이고, 중간에 그만두면 남은 줄만 지웁니다.
 *
 * 학비 표·학비외 표·학생별 회계 세 곳이 **이 창 하나**를 엽니다. 저장은 학비 쪽 줄이라, 학비외 표에서 열어도
 * 다음 학비 장에 붙습니다 - 창 안에 그렇게 적어 둡니다.
 */

export type ExtraChargeRow = {
  id: string;
  student_id: string;
  term_id: string | null;
  plan_id: string | null;
  name: string;
  amount: number | string;
  reason: string;
  target_month: string | null;
  series_id?: string | null;
  repeat?: "once" | "monthly" | null;
  series_from?: string | null;
  series_to?: string | null;
  invoice_id?: string | null;
};

export const EXTRA_CHARGE_COLS = "id, student_id, term_id, plan_id, name, amount, reason, target_month, series_id, repeat, series_from, series_to, invoice_id";

export default function ExtraChargeModal({
  student,
  termId,
  month,
  plans,
  createdBy,
  onClose,
  onSaved,
}: {
  student: { id: string; name: string };
  termId: string | null;
  /** 보고 있는 달(YYYY-MM). 「언제부터」의 기본값입니다. */
  month: MonthKey;
  /** 어느 항목에 붙는 돈인지 고를 때(선택). 없으면 「학비 전체」. */
  plans?: { id: string; name: string }[];
  createdBy: string;
  onClose: () => void;
  onSaved?: (rows: ExtraChargeRow[]) => void;
}) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [repeat, setRepeat] = useState<"once" | "monthly">("once");
  const [from, setFrom] = useState<MonthKey>(month);
  const [to, setTo] = useState<MonthKey>(shiftMonth(month, 2));
  const [planId, setPlanId] = useState("");
  const [note, setNote] = useState("");

  const amt = Math.round(Number(amount.replace(/[^\d-]/g, "")));
  const months: MonthKey[] = (() => {
    if (repeat === "once") return [from];
    const out: MonthKey[] = [];
    let m = from;
    for (let i = 0; i < 24 && m <= to; i += 1) {
      out.push(m);
      m = shiftMonth(m, 1);
    }
    return out;
  })();

  async function save() {
    if (!title.trim()) return notify("제목을 적어주세요 - 청구서에 이 글자가 그대로 찍힙니다.", "error");
    if (!Number.isFinite(amt) || amt === 0) return notify("금액을 적어주세요(덜 받으면 앞에 -).", "error");
    if (repeat === "monthly" && months.length === 0) return notify("끝나는 달이 시작하는 달보다 앞입니다.", "error");
    setBusy(true);
    const sb = createClient();
    const seriesId = repeat === "monthly" ? crypto.randomUUID() : null;
    const rows = months.map((m) => ({
      student_id: student.id,
      term_id: termId,
      plan_id: planId || null,
      // 매달이면 청구서 줄에 「셔틀비 11월분」처럼 달이 붙습니다 - 달이 없으면 어느 달 것인지 학부모가 모릅니다.
      name: repeat === "monthly" ? `${title.trim()} ${Number(m.slice(5))}월분` : title.trim(),
      amount: amt,
      // 사유는 안 적어도 됩니다. 비면 제목이 곧 사유입니다 - 적으라고 막으면 아무 글자나 들어갑니다.
      reason: note.trim() || title.trim(),
      target_month: m,
      series_id: seriesId,
      repeat,
      series_from: repeat === "monthly" ? from : null,
      series_to: repeat === "monthly" ? to : null,
      created_by: createdBy,
    }));
    const { data, error } = await sb.from("tuition_extra_charges").insert(rows).select(EXTRA_CHARGE_COLS);
    setBusy(false);
    if (error) return notify(`추가 항목을 적지 못했습니다: ${error.message}`, "error");
    onSaved?.((data as ExtraChargeRow[] | null) ?? []);
    notify(
      repeat === "monthly"
        ? `${student.name} — 「${title.trim()}」 ${won(Math.abs(amt))}을 ${from}~${to} 매달(${months.length}개월) 학비 장에 붙입니다.`
        : `${student.name} — 「${title.trim()}」 ${won(Math.abs(amt))}을 ${from} 학비 장에 붙입니다.`,
      "success",
    );
    onClose();
  }

  const monthOptions = Array.from({ length: 14 }, (_, i) => shiftMonth(month, i - 2));
  const field = "flex-1 rounded border border-slate-300 px-2 py-1 text-[12px]";
  const btn = "rounded-lg px-3 py-1.5 text-[12px] font-bold";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[15px] font-black text-slate-800">+ {student.name} · 추가 항목</h3>
          <button onClick={onClose} className="text-[12px] text-slate-400 hover:text-slate-700">닫기 ✕</button>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-slate-500">
          이 아이에게만 받는 돈입니다(셔틀비·오케스트라 추가금 등). 요금표에 항목을 만들지 않고, <b>다음에 발행하는 학비 청구서</b>에
          제목 그대로 한 줄로 붙습니다. 학비 표 비고에 「+ 제목 금액 · 언제」로 보입니다.
        </p>
        <div className="flex flex-col gap-2 text-[12px]">
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-slate-500">제목</span>
            <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 40))} placeholder="예: 셔틀비 · 오케스트라 추가금" className={field} autoFocus />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-slate-500">금액</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="예: 50000 · 덜 받으면 -50000" className={field + " tabular-nums"} />
            {Number.isFinite(amt) && amt !== 0 && <span className="text-[11px] font-bold text-slate-700">{won(Math.abs(amt))}</span>}
          </label>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-slate-500">반복</span>
            <div className="flex gap-1">
              {(
                [
                  ["once", "한 번만"],
                  ["monthly", "매달"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRepeat(k)}
                  className={"rounded-full px-2.5 py-0.5 text-[11px] font-bold " + (repeat === k ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-slate-500">{repeat === "monthly" ? "시작" : "어느 달"}</span>
            <select value={from} onChange={(e) => setFrom(e.target.value as MonthKey)} className={field}>
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}{m === month ? " (보는 달)" : ""}</option>
              ))}
            </select>
          </label>
          {repeat === "monthly" && (
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-slate-500">끝</span>
              <select value={to} onChange={(e) => setTo(e.target.value as MonthKey)} className={field}>
                {monthOptions.filter((m) => m >= from).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="shrink-0 text-[11px] text-slate-500">{months.length}개월</span>
            </label>
          )}
          {plans && plans.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-slate-500">항목</span>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={field}>
                <option value="">학비 전체(어느 항목에도 안 붙임)</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}에 붙임</option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-slate-500">메모</span>
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} placeholder="왜 받는지(안 적어도 됩니다)" className={field} />
          </label>
        </div>
        {repeat === "monthly" && months.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            청구서에는 「{title.trim() || "제목"} {Number(from.slice(5))}월분」처럼 달이 붙어 나갑니다. 중간에 그만두면 학비 표 비고에서 남은 달을 지우면 됩니다.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btn + " bg-slate-100 text-slate-600"}>취소</button>
          <button onClick={() => void save()} disabled={busy} className={btn + " bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40"}>
            {repeat === "monthly" ? `${months.length}개월 적어 두기` : "적어 두기"}
          </button>
        </div>
      </div>
    </div>
  );
}
