"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";

// 네이티브 confirm()을 대체하는 공용 확인창입니다 - 브라우저 기본 대화상자는 모바일에서
// 특히 거칠고 앱 톤과 어긋나서(요청: "UX 점검"), 같은 "확인/취소" 흐름을 앱 안에서 자연스럽게
// 보여주도록 만들었습니다. 기존 코드의 `if (!confirm("...")) return;` 패턴을
// `if (!(await confirmAction("..."))) return;` 로 그대로 바꿔 쓸 수 있게 Promise<boolean>을
// 반환합니다.
type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // 삭제처럼 되돌리기 어려운 동작이면 확인 버튼을 빨간색으로.
};

type PendingConfirm = {
  message: string;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
};

type ConfirmContextValue = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue>(async () => false);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirmAction = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      setPending({ message, options, resolve });
    });
  }, []);

  function close(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}
      {pending &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4"
            onClick={() => close(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="shell-entry-fade w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            >
              {pending.options.title && <h2 className="mb-1.5 text-sm font-bold text-slate-800">{pending.options.title}</h2>}
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{pending.message}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                >
                  {pending.options.cancelLabel ?? "취소"}
                </button>
                <button
                  type="button"
                  onClick={() => close(true)}
                  autoFocus
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-semibold text-white " +
                    (pending.options.danger ? "bg-red-600 hover:bg-red-700" : "bg-gia-navy hover:bg-gia-navy-2")
                  }
                >
                  {pending.options.confirmLabel ?? "확인"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </ConfirmContext.Provider>
  );
}

// confirm(...) 대신: const confirmAction = useConfirm(); if (!(await confirmAction("삭제할까요?"))) return;
export function useConfirm() {
  return useContext(ConfirmContext);
}
