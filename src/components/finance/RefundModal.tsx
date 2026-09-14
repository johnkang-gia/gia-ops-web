"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst } from "@/lib/kst";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export type RefundTarget = {
  invoiceId: string;
  invoiceNo: string;
  studentName: string;
  /** 이 청구서로 지금까지 받은 돈(이미 돌려준 것을 뺀 값). 여기까지만 돌려줄 수 있습니다. */
  held: number;
  /** 되돌리려는 입금 한 줄에서 눌렀으면 그 금액을 기본값으로 채웁니다. */
  suggest?: number;
  method?: string | null;
};

/**
 * **돌려드린 돈을 적습니다.**
 *
 * 원래 입금 줄은 **안 지웁니다.** 지우면 그날 수납 집계가 바뀌고 이미 보고한 숫자와
 * 달라지는데, 왜 달라졌는지 되짚을 곳이 없습니다. 대신 반대 방향 한 줄을 더합니다 -
 * 잔액은 `청구액 − sum(입금)` 이라 음수 한 줄이 들어가면 잔액·월별·거래명세서가 손댈 것
 * 없이 맞습니다(`settlement.ts`).
 *
 * **이유를 반드시 받습니다.** 되돌릴 수 없는 일이라, 이유가 안 남으면 몇 달 뒤에 설명할
 * 방법이 없습니다. 화면과 데이터베이스가 같은 검사를 겁니다.
 */
export default function RefundModal({ target, onClose }: { target: RefundTarget; onClose: () => void }) {
  const notify = useToast();
  const router = useRouter();
  const [amount, setAmount] = useState(String(target.suggest ?? target.held));
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(target.method ?? "계좌이체");
  const [at, setAt] = useState(todayKst());
  const [busy, setBusy] = useState(false);

  const asked = Math.round(Number(amount.replace(/[^0-9]/g, "")) || 0);
  const over = asked > target.held;

  async function submit() {
    if (asked <= 0) {
      notify("돌려줄 금액을 적어주세요.", "error");
      return;
    }
    // 화면에서 막아도 서버가 같은 검사를 겁니다. 화면에서 안 보여주는 것은 예의이지
    // 자물쇠가 아닙니다(CLAUDE.md 2-8).
    if (over) {
      notify(`받은 돈은 ${won(target.held)}입니다. 그보다 많이 돌려줄 수 없습니다.`, "error");
      return;
    }
    if (!reason.trim()) {
      notify("환불 사유를 적어주세요.", "error");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/finance/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: target.invoiceId, amount: asked, reason: reason.trim(), refundedAt: at, method }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    // 조용히 넘기면 돌려준 줄 알고 또 돌려줍니다.
    if (!res.ok) {
      notify(json?.error ?? "환불을 적지 못했습니다.", "error");
      return;
    }
    notify(`${won(asked)} 환불을 적었습니다.`, "success");
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-bold text-slate-900">↩️ 환불 적기</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {target.invoiceNo} · {target.studentName} · 받은 돈 <b className="text-slate-700">{won(target.held)}</b>
        </p>

        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          원래 입금 줄은 <b>지우지 않습니다.</b> 반대 방향 한 줄을 더합니다 — 그래야 그날 수납 집계가
          그대로 남고, 나중에 「왜 줄었지」를 되짚을 수 있습니다.
        </p>

        <label className="mt-3 block text-[11px] font-semibold text-slate-600">돌려줄 금액</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          className={
            "mt-1 w-full rounded-lg border px-2 py-1.5 text-right text-[14px] font-bold tabular-nums outline-none " +
            (over ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 focus:border-teal-400")
          }
        />
        {over && <p className="mt-1 text-[11px] font-semibold text-rose-600">받은 {won(target.held)} 보다 많습니다.</p>}

        <label className="mt-3 block text-[11px] font-semibold text-slate-600">
          왜 돌려주나요 <span className="text-rose-600">*</span>
        </label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 중도 퇴학 일할 환불 / 이중결제 / 금액 정정"
          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-teal-400"
        />

        <div className="mt-3 flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-slate-600">돌려준 날</label>
            <input
              type="date"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-teal-400"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-slate-600">어떻게</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-teal-400"
            >
              <option>계좌이체</option>
              <option>카드취소</option>
              <option>현금</option>
              <option>올톡페이</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-100">
            그만두기
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-rose-700 disabled:bg-slate-300"
          >
            {busy ? "적는 중…" : "환불 적기"}
          </button>
        </div>
      </div>
    </div>
  );
}
