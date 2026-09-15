"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/**
 * **설정 화면을 일하던 자리에서 그대로 여는 창 — 껍데기는 여기 하나입니다.**
 *
 * ── 왜 팝업인가 ─────────────────────────────────────────────────────────────
 *
 * 설정은 대개 **일을 하다가** 손대게 됩니다 — 「이 항목이 목록에 없네」, 「이 과목 담당이
 * 비었네」, 「이 날이 수업일로 잡혀 있네」. 그런데 그 설정이 다른 탭에 있으면, 고치러
 * 건너가는 순간 보고 있던 표의 학기·부서·체크·스크롤이 전부 풀립니다.
 *
 * **화면을 옮겨야 하는 일은 대개 안 하게 됩니다.** 그래서 「나중에 정리하자」가 되고,
 * 나중에 한 것은 대개 안 한 것입니다.
 *
 * ── 열 때 읽습니다 ──────────────────────────────────────────────────────────
 *
 * 부모 화면이 설정 자료까지 미리 들고 있으면 **팝업을 한 번도 안 여는 사람도** 그 조회를
 * 매번 치릅니다. 그래서 자료는 `/api/panel/:kind` 에서 **열 때** 받아옵니다.
 *
 * 한 번 받아온 것은 그 세션 동안 들고 있습니다 - 닫았다 다시 여는 것은 흔한 일이고,
 * 그때마다 다시 읽으면 창이 매번 깜빡입니다. 「다시 읽기」는 사람이 누릅니다.
 *
 * ── 닫을 때 뒤 화면을 다시 읽습니다 ─────────────────────────────────────────
 *
 * 항목을 만들거나 금액을 고쳤으면 **뒤의 표가 달라져야 합니다.** 안 읽으면 방금 만든
 * 것이 표에 없고, 사람은 저장이 안 된 줄 압니다.
 */

type State<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T; email: string }
  | { status: "error"; message: string };

export default function PanelModal<T>({
  open,
  onClose,
  kind,
  title,
  hint,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** `/api/panel/:kind` 의 종류. 창구 쪽 `PANELS` 에 있는 이름이어야 합니다. */
  kind: string;
  title: string;
  hint?: ReactNode;
  /** 받아온 자료로 안쪽 화면을 그립니다. 로그인한 사람의 메일도 함께 넘깁니다. */
  children: (data: T, currentUserEmail: string) => ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<State<T>>({ status: "idle" });

  const fetchData = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/panel/${kind}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body?.error ?? `자료를 읽지 못했습니다 (${res.status}).` });
        return;
      }
      setState({ status: "ready", data: body.data as T, email: body?.me?.email ?? "" });
    } catch (e) {
      // 조용히 빈 창을 띄우면 사람은 「설정이 하나도 없네」로 읽습니다. 다른 말입니다.
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [kind]);

  useEffect(() => {
    if (!open) return;
    if (state.status === "idle") void fetchData();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    // 뒤 화면이 같이 굴러가면 어디를 보고 있었는지 잃어버립니다.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.status, fetchData]);

  function close() {
    // 고친 것이 뒤의 표에 반영되도록 다시 읽습니다.
    router.refresh();
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/40 p-3 sm:p-6" onClick={close}>
      <div
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800">{title}</h2>
            {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void fetchData()}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
              title="다른 사람이 고친 것을 다시 받아옵니다"
            >
              다시 읽기
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-slate-700"
            >
              닫기
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {state.status === "loading" || state.status === "idle" ? (
            <p className="p-6 text-center text-[13px] text-slate-500">불러오는 중…</p>
          ) : state.status === "error" ? (
            <div className="p-6">
              <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
                {state.message}
              </p>
              <button
                type="button"
                onClick={() => void fetchData()}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                다시 시도
              </button>
            </div>
          ) : (
            children(state.data, state.email)
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
