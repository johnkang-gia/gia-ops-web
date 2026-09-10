"use client";

import { useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import type { Invoice } from "@/lib/types";

/**
 * **발행 취소 창** — 학비·학비외가 같은 창을 씁니다.
 *
 * ── 왜 한 곳에 두나 ──────────────────────────────────────────────────
 *
 * 취소는 되돌릴 수 없는 쪽에 가까운 일입니다(번호가 죽고, 학부모에게 나간 종이와 장부가
 * 어긋납니다). 화면마다 따로 만들면 한쪽에만 경고가 붙고 다른 쪽에는 안 붙는데, 빠진 쪽에서
 * 사고가 납니다 - 그리고 그 빠짐은 사고가 날 때까지 아무에게도 안 보입니다.
 *
 * ── 지우지 않습니다 ──────────────────────────────────────────────────
 *
 * 상태만 `취소` 로 바꾸고 누가·언제·왜 취소했는지를 남깁니다. 지워버리면 나중에 「그
 * 청구서 어디 갔냐」는 물음에 답할 방법이 없고, 번호도 비어 버립니다.
 *
 * ── 이미 받은 돈이 붙어 있을 때 ──────────────────────────────────────
 *
 * 「이미 받음」으로 만든 청구서에는 입금이 함께 붙어 있습니다. 그 돈은 **실제로 받은 돈**이라
 * 청구서를 취소한다고 없던 일이 되지 않습니다. 그래서 지우지 않고 **선입금으로 떼어냅니다** -
 * 다음 청구서를 만들면 저절로 충당됩니다. 창구가 그 사실을 세어 돌려주면 여기서 그대로
 * 알립니다.
 */
export default function CancelInvoiceModal({
  invoice,
  studentName,
  defaultReason = "",
  onDone,
  onClose,
}: {
  invoice: Invoice;
  studentName: string;
  /** 부르는 쪽이 이유를 이미 아는 경우(중복 발행 정리 등) 미리 채웁니다. */
  defaultReason?: string;
  /** 취소된 청구서. 부르는 쪽이 목록을 고쳐 그립니다. */
  onDone: (invoice: Invoice) => void;
  onClose: () => void;
}) {
  const notify = useToast();
  const [reason, setReason] = useState(defaultReason);
  const [busy, setBusy] = useState(false);

  async function run(force = false) {
    setBusy(true);
    try {
      const res = await fetch("/api/finance/invoices/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, reason, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 받은 돈이 붙어 있으면 한 번 더 묻습니다. 그냥 막아버리면 손쓸 방법이 없습니다.
        if (json?.needsForce && window.confirm(`${json.error}\n\n그래도 취소할까요?`)) {
          setBusy(false);
          await run(true);
          return;
        }
        notify(json?.error ?? "취소하지 못했습니다.", "error");
        return;
      }
      const done = json.invoice as Invoice;
      const moved = Number(json?.detached ?? 0);
      onDone(done);
      notify(
        moved > 0
          ? `${done.invoice_no} 을(를) 취소했습니다. 받은 돈 ${moved.toLocaleString("ko-KR")}원은 선입금으로 남아 다음 청구서에 충당됩니다.`
          : `${done.invoice_no} 을(를) 취소했습니다. 항목을 고친 뒤 다시 발행할 수 있습니다.`,
        "success",
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const total = Number(invoice.total_amount ?? 0);

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-base font-black text-slate-800">발행 취소</p>
        <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
          <b>{studentName}</b> · {invoice.invoice_no} · {total.toLocaleString("ko-KR")}원
          <br />
          지우지 않고 <b>취소로 남깁니다.</b> 나중에 무엇이 왜 취소됐는지 읽을 수 있어야 합니다. 취소하면 이 학생은 다시
          <b> 미발행</b>이 되어, 항목을 고친 뒤 새로 발행할 수 있습니다(새 번호가 붙습니다).
        </p>

        {/* 이미 낸 분께 또 청구가 나가는 일을 막는 표시입니다. 여기서 취소해도 올톡페이 쪽은
            그대로라, 그 사실을 적어두지 않으면 학부모만 두 번 겪습니다. */}
        {invoice.exported_at && (
          <p className="mb-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-[11px] text-orange-900">
            이 청구서는 <b>이미 올톡페이로 내보냈습니다.</b> 학부모에게 청구서가 가 있을 수 있으니, 올톡페이 화면에서도 그
            청구를 취소해주세요 — 여기서 취소해도 올톡페이 쪽은 그대로입니다.
          </p>
        )}

        {invoice.issued_offline && (
          <p className="mb-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] text-sky-900">
            <b>이미 받음</b>으로 만든 청구서입니다. 취소해도 받은 돈은 지우지 않고 <b>선입금으로 남깁니다</b> — 다음
            청구서를 만들 때 저절로 충당됩니다.
          </p>
        )}

        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="취소 사유 (예: 교재 수량 잘못 넣음)"
          className="mb-3 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-600">
            그만두기
          </button>
          <button
            onClick={() => void run()}
            disabled={busy}
            className="ml-auto rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? "취소하는 중…" : "발행 취소"}
          </button>
        </div>
      </div>
    </div>
  );
}
