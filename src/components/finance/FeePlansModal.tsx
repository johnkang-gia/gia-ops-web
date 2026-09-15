"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import FeePlansClient from "./FeePlansClient";
import type { FeePlan, FeePaymentOption, FeeDiscount } from "@/lib/types";

/**
 * **납부 항목·할인을 청구 화면에서 그대로 엽니다.**
 *
 * ── 왜 팝업인가 ─────────────────────────────────────────────────────────────
 *
 * 항목·할인은 청구를 하다가 손대게 됩니다 — 「이 아이 할인이 목록에 없네」, 「기준금액이
 * 올랐네」. 그런데 지금까지는 **다른 대분류 탭**이었습니다. 고치러 건너가면 보고 있던 표의
 * 학기·부서·체크가 전부 풀리고, 돌아와서 처음부터 다시 찾아야 했습니다.
 *
 * 화면을 옮겨야 하는 일은 대개 **안 하게 됩니다.** 그래서 「나중에 정리하자」가 되고,
 * 그 사이 학부모에게는 옛 금액이 나갑니다.
 *
 * ── 닫을 때 다시 읽습니다 ───────────────────────────────────────────────────
 *
 * 항목을 만들거나 기준금액을 고쳤으면 **표의 열과 금액이 달라져야 합니다.** 안 읽으면
 * 방금 만든 항목이 표에 없고, 사람은 저장이 안 된 줄 압니다.
 */
export default function FeePlansModal({
  open,
  onClose,
  plans,
  options,
  discounts,
  canApprove,
  currentUserEmail,
}: {
  open: boolean;
  onClose: () => void;
  plans: FeePlan[];
  options: FeePaymentOption[];
  discounts: FeeDiscount[];
  canApprove: boolean;
  currentUserEmail: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // 뒤 화면이 같이 굴러가면 어디를 보고 있었는지 잃어버립니다.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  function close() {
    // 고친 것이 표에 반영되도록 다시 읽습니다.
    router.refresh();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/40 p-3 sm:p-6" onClick={close}>
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">📚 납부 항목 · 할인</h2>
            <p className="text-[11px] text-slate-500">
              여기서 고친 기준금액·옵션·할인은 <b>닫는 즉시 뒤의 표에 반영</b>됩니다. 이미 나간 청구서는 그대로입니다.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-slate-700"
          >
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FeePlansClient
            plans={plans}
            options={options}
            discounts={discounts}
            canApprove={canApprove}
            currentUserEmail={currentUserEmail}
            loadError={null}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
