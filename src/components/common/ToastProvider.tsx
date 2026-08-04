"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 여기저기 흩어져 있던 네이티브 alert()를 대체하는 공용 토스트 알림입니다(요청: "UX 점검"에서
// 발견된 "삭제 확인과 실패 알림이 브라우저 기본 alert/confirm으로 처리되고 있어 앱 톤과
// 어긋난다" 문제를 해결). 화면 우하단에 쌓이고, 몇 초 후 자동으로 사라지거나 눌러서 바로 닫을
// 수 있습니다.
type ToastType = "error" | "success" | "info";
type Toast = { id: number; message: string; type: ToastType };

type ToastContextValue = {
  notify: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue>({ notify: () => {} });

const TYPE_STYLE: Record<ToastType, string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-slate-200 bg-white text-slate-700",
};

const TYPE_ICON: Record<ToastType, string> = {
  error: "⚠️",
  success: "✅",
  info: "ℹ️",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const notify = useCallback((message: string, type: ToastType = "info") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    // 에러는 조금 더 오래(사용자가 실패 사유를 읽을 시간을 주기 위해), 성공/안내는 짧게.
    const ttl = type === "error" ? 5000 : 3000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, ttl);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
            {toasts.map((t) => (
              <div
                key={t.id}
                onClick={() => dismiss(t.id)}
                className={
                  "shell-entry-fade pointer-events-auto flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] shadow-lg " +
                  TYPE_STYLE[t.type]
                }
              >
                <span className="shrink-0">{TYPE_ICON[t.type]}</span>
                <span className="min-w-0 flex-1 leading-relaxed">{t.message}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

// alert(...) 대신: const notify = useToast(); notify("실패했습니다", "error");
export function useToast() {
  return useContext(ToastContext).notify;
}
