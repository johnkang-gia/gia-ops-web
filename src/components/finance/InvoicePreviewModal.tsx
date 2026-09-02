"use client";

import { useEffect, useRef, useState } from "react";

// 인보이스 미리보기 창.
//
// 새 탭으로 열면 확인할 때마다 탭을 열고 닫아야 합니다. 열 장을 훑을 때는 그 왕복이 일보다
// 오래 걸립니다. 그래서 **보던 화면 위에 띄웁니다.**
//
// 안쪽은 인쇄용 화면(/finance/invoices/[id]/print)을 그대로 불러옵니다. 종이와 미리보기가
// 같은 화면이어야 "화면에서 본 것과 인쇄된 것이 다르다"가 생기지 않습니다.

type Props = { invoiceId: string; label?: string; onClose: () => void };

export default function InvoicePreviewModal({ invoiceId, label, onClose }: Props) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const src = `/finance/invoices/${invoiceId}/print?embed=1`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 안쪽 화면을 인쇄합니다. 같은 도메인이라 바로 부를 수 있습니다. */
  function print() {
    const w = ref.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-black text-slate-800">🧾 {label ?? "인보이스"}</span>
          <button
            onClick={print}
            disabled={!ready}
            className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
          >
            🖨 인쇄 · PDF로 저장
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600"
            title="새 탭에서 크게 보기"
          >
            새 탭 ↗
          </a>
          <button onClick={onClose} className="px-1 text-sm font-bold text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-slate-100">
          {!ready && <p className="p-6 text-center text-[12px] text-slate-400">여는 중…</p>}
          <iframe
            ref={ref}
            src={src}
            title="인보이스"
            onLoad={() => setReady(true)}
            className={"h-full w-full " + (ready ? "" : "hidden")}
          />
        </div>
      </div>
    </div>
  );
}
