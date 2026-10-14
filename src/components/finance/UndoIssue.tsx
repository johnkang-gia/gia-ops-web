"use client";

import { useEffect, useState } from "react";

/**
 * **방금 발행한 것 5초 되돌리기.** 잘못 고르고 눌렀을 때 학생별 회계로 가서 한 장씩 찾아 취소하던 일을,
 * 누른 그 자리에서 끝냅니다. 되돌리기는 지우지 않고 「취소」로 남깁니다(취소 창구와 같은 길) - 누가
 * 언제 왜 취소했는지가 남아야 합니다.
 *
 * 5초가 지나면 사라집니다. 그 뒤에는 보통의 취소(학생 회계 창의 ↩)로 합니다 - 학부모에게 이미 나갔을
 * 수 있는 장을 아무 확인 없이 되돌리면 안 됩니다.
 */
export default function UndoIssue({
  ids,
  label,
  seconds = 5,
  onClose,
  onUndone,
}: {
  ids: string[];
  label: string;
  seconds?: number;
  onClose: () => void;
  onUndone: (cancelled: string[], failed: string[]) => void;
}) {
  const [left, setLeft] = useState(seconds);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (busy) return;
    if (left <= 0) {
      onClose();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, busy, onClose]);

  async function undo() {
    setBusy(true);
    const ok: string[] = [];
    const bad: string[] = [];
    for (const id of ids) {
      const res = await fetch("/api/finance/invoices/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: id, reason: "발행 직후 되돌리기" }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok) ok.push(id);
      else bad.push(`${id.slice(0, 6)}(${(body as { error?: string }).error ?? "응답 없음"})`);
    }
    onUndone(ok, bad);
    onClose();
  }

  return (
    <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 print:hidden">
      <div className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2 text-[13px] text-white shadow-2xl">
        <span>✓ {label}</span>
        <button
          type="button"
          onClick={() => void undo()}
          disabled={busy}
          className="rounded-lg bg-amber-500 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? "되돌리는 중…" : `되돌리기 ${left}`}
        </button>
      </div>
    </div>
  );
}
