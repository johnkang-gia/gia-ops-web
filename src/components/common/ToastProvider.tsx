"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 여기저기 흩어져 있던 네이티브 alert()를 대체하는 공용 토스트 알림입니다(요청: "UX 점검"에서
// 발견된 "삭제 확인과 실패 알림이 브라우저 기본 alert/confirm으로 처리되고 있어 앱 톤과
// 어긋난다" 문제를 해결). 화면 우하단에 쌓이고, 몇 초 후 자동으로 사라지거나 눌러서 바로 닫을
// 수 있습니다.
type ToastType = "error" | "success" | "info";
type Toast = { id: number; message: string; type: ToastType; undo?: () => void | Promise<void> };

/**
 * **되돌리기 단추가 붙는 알림.**
 *
 * 「내렸습니다」만 뜨고 사라지면, 잘못 누른 사람은 원래 화면을 찾아가 되살려야 합니다.
 * 대개 안 찾아가고, 그러면 잘못 내린 줄이 그대로 남습니다. 방금 한 일을 **그 자리에서**
 * 되돌릴 수 있어야 사람이 과감하게 누릅니다.
 */
export type ToastOptions = { undo?: () => void | Promise<void> };

type ToastContextValue = {
  notify: (message: string, type?: ToastType, options?: ToastOptions) => void;
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

  const notify = useCallback((message: string, type: ToastType = "info", options?: ToastOptions) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type, undo: options?.undo }]);
    // 에러는 조금 더 오래(사용자가 실패 사유를 읽을 시간을 주기 위해), 성공/안내는 짧게.
    // 되돌릴 수 있는 알림은 더 오래 둡니다 - 3초는 「어? 잘못 눌렀나」를 알아채기에 짧습니다.
    const ttl = options?.undo ? 8000 : type === "error" ? 5000 : 3000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, ttl);

    // ── 떴다 사라진 오류를 **기록에 남깁니다** ────────────────────────────
    //
    // 지금까지 화면 오류는 5초 뒤 사라지는 것이 전부였습니다. 담당자가 「방금 뭔가
    // 오류가 났는데」라고 해도 아무 데도 안 남아 있어서 무엇이었는지 물어볼 곳이
    // 없었습니다. 서버 오류는 오류 목록에 쌓이는데, **사람이 실제로 보는 오류는
    // 대부분 화면 쪽**이라 정작 중요한 것이 안 쌓이고 있었습니다.
    //
    // 기록하다 실패해도 조용히 넘어갑니다 - 오류를 남기려다 오류를 하나 더 만드는 것은
    // 뒤바뀐 일이고, 알림은 이미 사람 눈앞에 떠 있습니다.
    if (type === "error") {
      void fetch("/api/errors/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true, // 화면을 옮겨도 보내지던 것은 마저 보냅니다
        body: JSON.stringify({
          message,
          where: typeof window === "undefined" ? "" : window.location.pathname,
        }),
      }).catch(() => {});
    }
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
                {t.undo && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation(); // 알림을 닫는 클릭과 겹치지 않게
                      dismiss(t.id);
                      void t.undo?.();
                    }}
                    className="shrink-0 rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-slate-700"
                  >
                    되돌리기
                  </button>
                )}
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
