"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * **창(모달)을 문서 맨 위층에 그립니다.**
 *
 * `fixed inset-0 z-[…]` 창이라도 조상 중에 `position: sticky`(z 없이)·`transform` 이 있으면 그 조상 안에 갇힙니다.
 * 학비 표의 펼친 줄은 가로로 밀어도 따라오게 `sticky` 로 두었는데, 그 안에서 연 「+ 추가 항목」·발행 미리보기 창이
 * 표의 고정 머리줄·바닥 합계줄(z-20·z-30) 아래로 깔려 가려졌습니다. z 값을 아무리 올려도 갇힌 층 안의 숫자라
 * 소용이 없어서, 창을 `document.body` 로 옮깁니다.
 *
 * `on` 이 거짓이면 제자리에 그립니다 - 이미 맨 위층에 떠 있는 창 안에서는 옮길 이유가 없습니다.
 */
export default function BodyLayer({ on = true, children }: { on?: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!on) return <>{children}</>;
  if (!mounted) return null;
  return createPortal(children, document.body);
}
