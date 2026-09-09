"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import type { Invoice } from "@/lib/types";
import { todayKst } from "@/lib/kst";
import { won } from "@/lib/feeItems";
import { IDENTIFIER_LABEL, digitsOnly, formatIdentifier, identifierProblem, type ReceiptPurpose } from "@/lib/cashReceipt";
import type { ReceiptLite } from "./InvoiceGridClient";

/**
 * 현금영수증 칸 — 표의 작은 표시와, 눌렀을 때 뜨는 창.
 *
 * 청구서 명단 화면(2,250줄)에서 떼어냈습니다. 현금영수증은 청구서와 붙어 다니지만 하는
 * 일이 다르고, 표를 그리는 코드 사이에 끼어 있으면 둘 다 읽기 어려워집니다.
 * **동작은 그대로 두고 자리만 옮겼습니다.**
 */

/**
 * 청구서 칸 안의 현금영수증 표시.
 *
 * 네 가지를 구별합니다. 「아직 안 물어봄」과 「번호를 못 받음」을 같은 모양으로 두면,
 * 표를 훑을 때 무엇을 해야 하는지가 안 보입니다 — 전자는 여쭤야 하고, 후자는 이미 여쭀는데
 * 번호만 없는 것입니다.
 */
export function ReceiptChip({ receipt, onClick }: { receipt?: ReceiptLite; onClick: () => void }) {
  const look = !receipt
    ? { cls: "bg-slate-100 text-slate-400 hover:bg-slate-200", text: "🧾＋", title: "현금영수증 요청을 받았으면 눌러 접수합니다" }
    : receipt.status === "발행"
      ? { cls: "bg-emerald-100 text-emerald-800", text: "🧾 발행", title: "현금영수증을 끊었습니다" }
      : !digitsOnly(receipt.identifier)
        ? { cls: "bg-rose-100 text-rose-700", text: "🧾 번호없음", title: "요청은 받았는데 번호를 아직 못 받았습니다" }
        : identifierProblem(receipt.purpose, receipt.identifier)
          ? { cls: "bg-amber-100 text-amber-800", text: "🧾 번호확인", title: identifierProblem(receipt.purpose, receipt.identifier)! }
          : { cls: "bg-amber-100 text-amber-800", text: "🧾 대기", title: `${formatIdentifier(receipt.purpose, receipt.identifier)} — 아직 안 끊었습니다` };

  return (
    <button onClick={onClick} className={"rounded px-1 text-[10px] font-bold " + look.cls} title={look.title}>
      {look.text}
    </button>
  );
}

/**
 * 청구서 한 장의 현금영수증을 넣고 고칩니다.
 *
 * 창을 따로 띄우는 이유: 청구서 칸은 왼쪽에 고정된 칸이라 그 안에서 펼치면 잘립니다.
 * 그리고 구분·번호·금액을 한 번에 보여줘야 「사업자 칸에 휴대폰번호」 같은 실수가 그 자리에서
 * 드러납니다.
 */
export function ReceiptModal({
  invoice,
  studentName,
  receipt,
  currentUserName,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  studentName: string;
  receipt?: ReceiptLite;
  currentUserName: string;
  onClose: () => void;
  onSaved: (row: ReceiptLite) => void;
}) {
  const notify = useToast();
  const [purpose, setPurpose] = useState<ReceiptPurpose>(receipt?.purpose ?? "소득공제");
  const [idText, setIdText] = useState(receipt?.identifier ?? "");
  // 금액은 청구서 총액이 기본입니다. 손으로 다시 치게 하면 자릿수를 틀립니다.
  const [amount, setAmount] = useState(String(Number(receipt?.amount ?? invoice.total_amount)));
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount.replace(/[^0-9]/g, ""));
  const draftProblem = idText.trim() ? identifierProblem(purpose, idText) : null;

  async function save(nextStatus: "신청" | "발행" | "취소") {
    if (!(amountNum > 0)) return notify("금액을 적어주세요. 단말기에 칠 금액입니다.", "error");
    setBusy(true);
    const base = {
      purpose,
      identifier: digitsOnly(idText) || null,
      amount: amountNum,
      status: nextStatus,
      ...(nextStatus === "발행"
        ? { issued_at: todayKst(), issued_by: currentUserName }
        : { issued_at: null, issued_by: null, printed_at: null }),
    };
    const sb = createClient();
    const { data, error } = receipt
      ? await sb.from("cash_receipts").update(base).eq("id", receipt.id).select("*").single()
      : await sb
          .from("cash_receipts")
          .insert({
            ...base,
            invoice_id: invoice.id,
            student_id: invoice.student_id,
            person_name: invoice.student_id ? null : studentName,
            requested_by: currentUserName,
          })
          .select("*")
          .single();
    setBusy(false);
    if (error || !data) {
      // 조용히 닫으면 화면에는 저장된 것처럼 보이는데 기록은 그대로입니다.
      notify("저장하지 못했습니다: " + (error?.message ?? "알 수 없는 이유"), "error");
      return;
    }
    onSaved(data as ReceiptLite);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold text-slate-800">🧾 현금영수증</p>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {studentName} · {invoice.invoice_no}
          {invoice.category ? ` · ${invoice.category}` : ""} · 청구액 {won(Number(invoice.total_amount))}
        </p>

        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500">구분</span>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as ReceiptPurpose)}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]"
            >
              <option value="소득공제">소득공제 (개인 · 휴대폰번호)</option>
              <option value="지출증빙">지출증빙 (사업자 · 사업자등록번호)</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500">{IDENTIFIER_LABEL[purpose]}</span>
            <input
              value={idText}
              onChange={(e) => setIdText(e.target.value)}
              inputMode="numeric"
              placeholder="나중에 받아도 됩니다"
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-[15px]"
            />
            <span className="mt-0.5 block text-[11px]">
              {draftProblem ? (
                <span className="font-bold text-rose-600">{draftProblem}</span>
              ) : idText.trim() ? (
                <span className="text-slate-500">
                  단말기에 칠 번호: <b className="font-mono text-slate-800">{formatIdentifier(purpose, idText)}</b>
                </span>
              ) : (
                <span className="text-slate-400">비워두면 「번호 없음」으로 남습니다 — 요청 자체는 사라지지 않습니다.</span>
              )}
            </span>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500">금액</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right text-[14px] tabular-nums"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !!draftProblem}
            onClick={() => void save("신청")}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
          >
            {receipt ? "저장" : "접수"}
          </button>
          {receipt?.status !== "발행" && (
            <button
              type="button"
              disabled={busy || !!draftProblem}
              onClick={() => void save("발행")}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
              title="단말기에서 이미 끊었으면 바로 발행함으로 남깁니다"
            >
              ✓ 발행함
            </button>
          )}
          {receipt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(receipt.status === "발행" ? "신청" : "취소")}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-500 disabled:opacity-40"
            >
              {receipt.status === "발행" ? "되돌리기" : "요청 취소"}
            </button>
          )}
          <a
            href="/finance/receipts"
            className="ml-auto text-[11px] font-semibold text-slate-500 underline"
            title="종이로 뽑아 단말기에서 한 번에 끊습니다"
          >
            현금영수증 화면 →
          </a>
        </div>
      </div>
    </div>
  );
}
