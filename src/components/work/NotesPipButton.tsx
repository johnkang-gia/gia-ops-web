"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ToastProvider } from "@/components/common/ToastProvider";
import NoteBoard from "./NoteBoard";

/**
 * **쪽지 창 — 늘 맨 위에 떠 있는 작은 창.**
 *
 * ── 왜 보통 팝업으로는 안 되나 ─────────────────────────────────────────────
 *
 * `window.open` 으로 띄운 창은 업무보드를 누르는 순간 뒤로 넘어갑니다. 쪽지는 **일하면서
 * 곁눈으로 보는 것**이라, 뒤로 넘어가면 없는 것과 같습니다 - 그게 이 기능이 안 쓰이던
 * 이유입니다.
 *
 * 크롬의 **문서 PiP**(Document Picture-in-Picture)는 다른 창을 눌러도 위에 남습니다.
 * 그래서 이 창을 먼저 시도하고, 안 되는 브라우저에서만 예전 팝업으로 내려갑니다.
 *
 * ── 왜 화면을 통째로 옮겨 심나 ─────────────────────────────────────────────
 *
 * PiP 창은 **같은 자바스크립트 세상**입니다. 그래서 주소를 새로 여는 것이 아니라 쪽지판을
 * 그 창의 몸통에 그대로 그립니다(포털). 로그인·자료 연결이 그대로라 새로 읽을 것이 없습니다.
 * 다만 스타일시트는 창마다 따로이므로 **열 때 복사해 넣어야** 글자와 색이 살아납니다.
 */

type PipWindow = Window & { addEventListener: Window["addEventListener"] };

type DocumentPip = {
  requestWindow: (opts: { width: number; height: number }) => Promise<PipWindow>;
};

function pipApi(): DocumentPip | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null;
}

export default function NotesPipButton({
  department,
  currentUserEmail,
  currentUserName,
}: {
  department: string;
  currentUserEmail: string;
  currentUserName: string | null;
}) {
  const [pip, setPip] = useState<PipWindow | null>(null);

  /** 이 창의 스타일을 PiP 창으로 복사합니다. 안 하면 글자만 덩그러니 남습니다. */
  const copyStyles = useCallback((win: PipWindow) => {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const css = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join("");
        const el = win.document.createElement("style");
        el.textContent = css;
        win.document.head.appendChild(el);
      } catch {
        // 다른 곳에서 불러온 스타일시트는 규칙을 읽을 수 없습니다. 그때는 링크로 겁니다.
        const link = win.document.createElement("link");
        link.rel = "stylesheet";
        if (sheet.href) {
          link.href = sheet.href;
          win.document.head.appendChild(link);
        }
      }
    }
  }, []);

  async function open() {
    const api = pipApi();
    if (!api) {
      // 문서 PiP 를 못 쓰는 브라우저. 예전처럼 작은 창으로 띄웁니다 - 맨 위에 남지는
      // 않지만, 아예 못 쓰는 것보다 낫습니다.
      window.open("/notes-window", "gia-notes", "width=420,height=620,menubar=no,toolbar=no,location=no,status=no");
      return;
    }
    try {
      const win = await api.requestWindow({ width: 380, height: 560 });
      win.document.title = "GIA 운영 — 쪽지";
      copyStyles(win);
      win.document.body.style.margin = "0";
      win.document.body.style.background = "#f8fafc";
      win.addEventListener("pagehide", () => setPip(null));
      setPip(win);
    } catch {
      // 사람이 창 열기를 거절했거나 크기가 안 맞는 경우. 조용히 넘어갑니다 - 단추를 한 번
      // 더 누르면 그만입니다.
    }
  }

  // 화면을 떠날 때 창도 함께 닫습니다. 남겨두면 자료가 안 붙는 빈 창이 떠 있습니다.
  useEffect(() => () => pip?.close(), [pip]);

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        title="쪽지를 작은 창으로 띄웁니다 — 다른 창을 눌러도 맨 위에 남습니다"
        className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50"
      >
        📝 쪽지 창
      </button>

      {pip &&
        createPortal(
          <ToastProvider>
            <div className="flex h-screen flex-col bg-slate-50">
              <header className="flex shrink-0 items-baseline gap-1.5 border-b border-black/5 bg-white px-3 py-2">
                <span className="text-[13px] font-bold text-slate-700">📝 쪽지</span>
                <span className="text-[11px] font-semibold text-slate-500">{department}</span>
                <span className="ml-auto text-[10px] text-slate-400">다같이 봅니다 · 지난 것은 저절로 떨어집니다</span>
              </header>
              <div className="min-h-0 flex-1 overflow-hidden p-2">
                <NoteBoard department={department} currentUserEmail={currentUserEmail} currentUserName={currentUserName} />
              </div>
            </div>
          </ToastProvider>,
          pip.document.body,
        )}
    </>
  );
}
