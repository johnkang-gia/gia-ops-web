"use client";

import { useState } from "react";
import { mismatch, paidMemo, remaining, resolveAmount, sumPicked, won, type PayableLine } from "@/lib/alreadyPaid";
import { todayKst } from "@/lib/kst";

/**
 * **이미 받은 돈을 적는 팝업** — 학비·학비외가 함께 씁니다.
 *
 * ── 왜 항목 체크와 금액을 다 두나 ────────────────────────────────────
 *
 * 돈이 들어오는 모양이 두 가지입니다.
 *
 * **항목별로** — 올톡페이는 항목마다 결제 문자가 따로 나갑니다. 교복은 결제했는데 교재는
 * 안 한 집이 생깁니다. 금액만 적으면 「23만원 받음」으로만 남고 **무엇이 남았는지**를
 * 아무도 모릅니다.
 *
 * **금액만** — 미납이 쌓인 집은 「이번엔 30만원만」처럼 나눠 냅니다. 그 돈이 어느 항목의
 * 것인지는 학부모도 정하지 않았고, 우리가 임의로 나누면 틀린 장부가 됩니다.
 *
 * 하나만 받게 만들면 나머지 절반은 늘 손으로 메모하게 되고, **메모는 장부가 아닙니다.**
 *
 * ── 어긋나도 됩니다 ──────────────────────────────────────────────────
 *
 * 항목을 체크하면 금액이 저절로 채워지지만, 고치면 고친 값이 이깁니다. 둘이 다른 것은
 * 오류가 아니라 흔한 일입니다 - 두 항목을 체크했는데 반만 보낸 집이 있습니다. 다르면
 * **그 사실을 그대로 적어** 며칠 뒤 「왜 금액이 안 맞지」가 되지 않게 합니다.
 */

export type AlreadyPaidResult = {
  paidAt: string;
  amount: number;
  method: string;
  memo: string;
  /** 체크한 항목. 부르는 쪽이 「무엇이 남았는지」를 셀 때 씁니다. */
  pickedIds: string[];
};

const METHODS = ["계좌이체", "카드", "현금", "올톡페이"];

export default function AlreadyPaidModal({
  title,
  studentName,
  lines,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  studentName: string;
  /** 이 학생에게 청구되는 항목들. 비어 있으면 금액만 받습니다. */
  lines: PayableLine[];
  busy?: boolean;
  onSubmit: (r: AlreadyPaidResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [typedAmount, setTypedAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayKst());
  const [method, setMethod] = useState(METHODS[0]);
  const [note, setNote] = useState("");

  const input = { pickedIds, typedAmount };
  const amount = resolveAmount(lines, input);
  const m = mismatch(lines, input);
  const left = remaining(lines, pickedIds);

  function toggle(id: string) {
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-8 w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-baseline gap-2">
          <b className="text-sm">💰 {title}</b>
          <span className="text-xs text-slate-500">{studentName}</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            닫기
          </button>
        </div>

        {/* ── 받은 항목 ────────────────────────────────────────────────── */}
        {lines.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-[11px] font-bold text-slate-600">
              받은 항목 <span className="font-normal text-slate-400">— 항목별로 따로 결제된 경우 체크하세요</span>
            </p>
            <div className="space-y-1">
              {lines.map((l) => {
                const on = pickedIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggle(l.id)}
                    className={
                      "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition " +
                      (on ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300")
                    }
                  >
                    <span className={"text-[13px] " + (on ? "text-emerald-600" : "text-slate-300")}>{on ? "☑" : "☐"}</span>
                    <span className={on ? "font-bold text-emerald-900" : "text-slate-700"}>{l.label}</span>
                    <span className="ml-auto tabular-nums text-[11px] text-slate-500">{won(l.amount)}</span>
                  </button>
                );
              })}
            </div>
            {/* 아직 안 받은 것을 그 자리에서 보여줍니다. 「무엇이 남았나」가 이 화면을
                여는 이유의 절반입니다. */}
            {pickedIds.length > 0 && left.length > 0 && (
              <p className="mt-1 text-[10px] text-amber-700">
                아직 안 받음: {left.map((l) => l.label).join(" · ")} ({won(left.reduce((n, l) => n + l.amount, 0))})
              </p>
            )}
          </div>
        )}

        {/* ── 받은 금액 ────────────────────────────────────────────────── */}
        <div className="mb-2">
          <p className="mb-1 text-[11px] font-bold text-slate-600">
            받은 금액{" "}
            <span className="font-normal text-slate-400">
              {lines.length > 0 ? "— 비워두면 체크한 합. 나눠 받았으면 실제 금액을 적으세요" : "— 실제로 받은 금액"}
            </span>
          </p>
          <input
            value={typedAmount}
            onChange={(e) => setTypedAmount(e.target.value)}
            inputMode="numeric"
            placeholder={pickedIds.length > 0 ? `${sumPicked(lines, pickedIds).toLocaleString()} (체크한 합)` : "예: 300000"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-blue-400"
          />
          {/* 체크한 합과 다르면 **그대로 적습니다.** 막지 않습니다 - 실제로 흔한 일입니다. */}
          {m.differs && (
            <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
              체크한 합 {won(m.picked)} 과 다릅니다. {won(m.actual)} 으로 기록하고, 차이는 미납으로 남습니다.
            </p>
          )}
        </div>

        <div className="mb-2 flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            받은 날
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            방법
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
            >
              {METHODS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모 (선택)"
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] outline-none focus:border-blue-400"
        />

        {/* 무엇으로 남는지 미리 보여줍니다. 누른 뒤에 확인하는 것보다 낫습니다. */}
        <p className="mb-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-500">
          기록될 내용: <b className="text-slate-700">{won(amount)}</b> · {paidMemo(lines, input, note)}
        </p>

        <button
          type="button"
          disabled={busy || amount <= 0}
          onClick={() => void onSubmit({ paidAt, amount, method, memo: paidMemo(lines, input, note), pickedIds })}
          className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy ? "기록 중…" : amount <= 0 ? "금액을 적거나 항목을 골라주세요" : `${won(amount)} 받음으로 기록`}
        </button>

        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          청구서는 만들되 학부모에게는 안 나갑니다 — 이미 낸 분께 또 내라고 하는 셈이 되니까요.
        </p>
      </div>
    </div>
  );
}
