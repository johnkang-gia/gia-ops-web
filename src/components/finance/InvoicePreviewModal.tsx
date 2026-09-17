"use client";

import { useEffect, useRef, useState } from "react";

// 인보이스 미리보기 창.
//
// 새 탭으로 열면 확인할 때마다 탭을 열고 닫아야 합니다. 열 장을 훑을 때는 그 왕복이 일보다
// 오래 걸립니다. 그래서 **보던 화면 위에 띄웁니다.**
//
// 안쪽은 인쇄용 화면(/finance/invoices/[id]/print)을 그대로 불러옵니다. 종이와 미리보기가
// 같은 화면이어야 "화면에서 본 것과 인쇄된 것이 다르다"가 생기지 않습니다.

type Props = {
  invoiceId: string;
  label?: string;
  onClose: () => void;
  /**
   * **학비 + 학비외를 한 장으로.** 학생 번호로 모읍니다.
   *
   * 청구서 번호가 아니라 학생 번호인 이유: 한쪽을 취소하고 다시 발행해도 링크가 살아 있어야
   * 합니다. 번호를 굳혀두면 그 링크는 없어진 장을 가리키고, 학부모에게 이미 보낸 링크가
   * 아무 말 없이 빈 종이가 됩니다.
   */
  studentId?: string | null;
  /** 지금 보고 있는 학기. 합본이 다른 학기 것까지 끌어오지 않게 좁힙니다. */
  termId?: string | null;
};

export default function InvoicePreviewModal({ invoiceId, label, onClose, studentId, termId }: Props) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * 어느 것을 볼지. **한 장만** 볼 때는 청구서 번호로, **합본**은 학생 번호로 엽니다.
   *
   * 합본은 열 때마다 그 아이의 살아 있는 청구서를 다시 읽습니다 - 한쪽을 고치면 합본도
   * 따라옵니다. 숫자를 여기서 옮겨 적지 않으므로 중간에 값이 바뀔 자리가 없습니다.
   */
  const [merged, setMerged] = useState(false);
  const src = merged && studentId
    ? `/finance/invoices/student/${studentId}/print?embed=1${termId ? `&term=${termId}` : ""}`
    : `/finance/invoices/${invoiceId}/print?embed=1`;

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
          {/* **학비 + 학비외 한 장.** 두 장을 따로 보내면 학부모는 두 번 결제하고, 어느 쪽을
              냈는지 물어봅니다. 합본은 열 때마다 살아 있는 장을 다시 읽으므로 한쪽을 고치면
              함께 바뀝니다 - 숫자를 옮겨 적는 자리가 없습니다. */}
          {studentId && (
            <span className="flex overflow-hidden rounded-lg border border-slate-300 text-[12px] font-bold">
              <button
                onClick={() => setMerged(false)}
                className={"px-2.5 py-1.5 " + (merged ? "bg-white text-slate-500" : "bg-slate-800 text-white")}
              >
                이 청구서만
              </button>
              <button
                onClick={() => setMerged(true)}
                className={"px-2.5 py-1.5 " + (merged ? "bg-slate-800 text-white" : "bg-white text-slate-500")}
                title="학비와 학비외를 한 장으로 묶어 보여줍니다. 각 칸은 School Tuition / Textbook & Materials 로 나뉩니다."
              >
                학비+학비외 한 장
              </button>
            </span>
          )}
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
