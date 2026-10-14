"use client";

import { useEffect, useState } from "react";

/**
 * 표를 키보드로 — ↑↓ 줄 이동, Enter 열기, Space 고르기, P 고정.
 *
 * 마우스로 줄을 찾아 누르고 다시 표로 돌아오는 왕복이 하루 수백 번입니다. 글자를 치는 칸에 있을 때는
 * 아무 일도 하지 않습니다(검색칸에서 ↑↓ 는 그 칸의 일입니다).
 */
export function useRowKeys<T extends { id: string }>(
  rows: readonly T[],
  handlers: { onOpen?: (row: T) => void; onToggle?: (row: T) => void; onPin?: (row: T) => void },
): number {
  const [i, setI] = useState(-1);
  useEffect(() => {
    if (i >= rows.length) setI(rows.length - 1);
  }, [rows.length, i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=dialog], dialog[open]")) return; // 창이 열려 있으면 창의 일
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setI((n) => Math.min(rows.length - 1, n + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      } else if (e.key === "Enter" && i >= 0 && rows[i] && handlers.onOpen) {
        e.preventDefault();
        handlers.onOpen(rows[i]);
      } else if (e.key === " " && i >= 0 && rows[i] && handlers.onToggle) {
        e.preventDefault();
        handlers.onToggle(rows[i]);
      } else if ((e.key === "p" || e.key === "P") && i >= 0 && rows[i] && handlers.onPin) {
        e.preventDefault();
        handlers.onPin(rows[i]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, i, handlers]);
  // 고른 줄이 화면 밖이면 보이게 굴립니다.
  useEffect(() => {
    if (i < 0 || !rows[i]) return;
    document.querySelector(`[data-row-id="${rows[i].id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i, rows]);
  return i;
}
