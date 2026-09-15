"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

/**
 * **표를 손으로 잡아 옆으로 밀 수 있게 합니다.**
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 학비외 청구표는 학생 × 항목이라 열이 스무 개를 넘습니다. 가로 스크롤은 처음부터
 * 있었지만, 요즘 브라우저는 **가만히 있으면 스크롤 막대를 숨깁니다.** 그래서 보는
 * 사람에게는 「오른쪽이 잘린 표」로 보이고, 잘린 줄 알면 거기 있는 항목은 아예 안
 * 봅니다 - 오류가 아니라 없는 것처럼 보입니다.
 *
 * 트랙패드 두 손가락으로 밀 수는 있지만 마우스만 쓰는 자리에서는 방법이 없습니다.
 *
 * ── 눌러서 고르는 것과 잡아서 미는 것을 가릅니다 ─────────────────────────────
 *
 * 이 표 안에는 체크상자·금액 칸·단추가 있습니다. 미는 동작이 누르는 동작을 삼키면
 * **금액을 고치려다 표가 밀립니다.** 그래서:
 *
 *   · 누른 자리가 입력칸·단추·링크면 아예 잡지 않습니다.
 *   · 4px 넘게 움직였을 때만 «미는 중»으로 칩니다. 손이 떨려서 1~2px 움직이는 것은
 *     누르는 동작입니다.
 *   · 민 뒤에 따라오는 click 한 번은 삼킵니다 - 안 그러면 민 자리에 있던 단추가
 *     눌립니다.
 */

// `[draggable="true"]` 도 잡지 않습니다. 열 제목을 끌어 순서를 바꾸는 자리인데, 미는 동작이
// 함께 일어나면 **표가 따라 밀려** 어디에 놓는지 보이지 않습니다.
const NO_DRAG = 'input,textarea,select,button,a,label,[contenteditable],[data-no-drag],[draggable="true"]';

export default function DragScroll({
  children,
  className = "",
  axis = "x",
}: {
  children: ReactNode;
  className?: string;
  /** 가로만 미는 표가 대부분입니다. 세로까지 밀면 페이지 스크롤과 싸웁니다. */
  axis?: "x" | "both";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const moved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 손가락·펜은 브라우저가 이미 밀어 줍니다. 여기서 또 밀면 두 배로 갑니다.
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    if ((e.target as HTMLElement | null)?.closest(NO_DRAG)) return;
    start.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    moved.current = false;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = start.current;
      const el = ref.current;
      if (!s || !el) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!moved.current && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      if (!moved.current) {
        moved.current = true;
        el.style.cursor = "grabbing";
        // 밀기 시작하면 글자가 파랗게 잡히는 것을 막습니다.
        el.style.userSelect = "none";
      }
      el.scrollLeft = s.left - dx;
      if (axis === "both") el.scrollTop = s.top - dy;
    },
    [axis],
  );

  const end = useCallback(() => {
    const el = ref.current;
    if (el) {
      el.style.cursor = "";
      el.style.userSelect = "";
    }
    start.current = null;
    // moved 는 여기서 지우지 않습니다 - 바로 뒤에 오는 click 을 삼켜야 합니다.
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const swallow = (e: MouseEvent) => {
      if (!moved.current) return;
      moved.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("click", swallow, true);
    return () => el.removeEventListener("click", swallow, true);
  }, []);

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerLeave={end}
      className={className}
    >
      {children}
    </div>
  );
}
