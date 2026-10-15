"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * **칸 옆에 뜨는 창 — 표 바깥으로 꺼내 그립니다.**
 *
 * 표는 가로로 굴리는 상자(overflow) 안에 있어서, 칸 안에 `absolute` 로 띄운 창은 그 상자 밖으로 나가는 순간 잘립니다.
 * 학생을 검색해 표가 한 줄로 줄면 상자 높이도 한 줄만 남아, 칸을 누르면 창의 대부분이 잘린 채 떴습니다. 화면은 넉넉한데
 * 매번 표를 굴려야 보였습니다.
 *
 * 그래서 창은 문서 맨 위(`document.body`)에 그리고, 위치만 누른 칸에 맞춥니다. 아래에 자리가 모자라면 위로 펼치고, 그래도
 * 넘치면 창 안에서 굴립니다. 표나 화면이 움직이면 따라갑니다.
 */
export default function AnchoredPanel({ width, onClose, children }: { width: number; onClose: () => void; children: ReactNode }) {
  const markRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  // 서버 그림에는 창이 없습니다. 붙은 뒤에만 문서 맨 위에 그립니다(서버·브라우저 첫 그림을 같게).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = markRef.current?.parentElement;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = panelRef.current?.scrollHeight ?? 400;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = below < Math.min(h, 360) && above > below;
      const maxHeight = Math.max(160, up ? above : below);
      const top = up ? Math.max(8, r.top - 4 - Math.min(h, maxHeight)) : r.bottom + 4;
      const left = Math.min(Math.max(8, r.left), vw - width - 8);
      setPos({ top, left, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    // 표 상자가 굴러가도 따라가야 해서 모든 스크롤을 듣습니다(capture).
    window.addEventListener("scroll", place, true);
    const ro = typeof ResizeObserver !== "undefined" && panelRef.current ? new ResizeObserver(place) : null;
    if (ro && panelRef.current) ro.observe(panelRef.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      ro?.disconnect();
    };
  }, [width, mounted]);

  return (
    <>
      <span ref={markRef} className="hidden" />
      {mounted &&
        createPortal(
          <>
            {/* 바깥을 누르면 닫힙니다. */}
            <div className="fixed inset-0 z-[90]" onClick={onClose} />
            <div
              ref={panelRef}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: pos?.maxHeight, visibility: pos ? "visible" : "hidden" }}
              className="fixed z-[91] overflow-y-auto rounded-xl border border-slate-300 bg-white p-2.5 text-left shadow-xl"
            >
              {children}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
