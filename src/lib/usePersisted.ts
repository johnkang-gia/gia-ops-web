"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 사람마다 기억하는 화면 설정(접어 둔 열·고른 보기). 이 브라우저에만 남깁니다.
 *
 * 처음 그림은 기본값으로 그리고, 붙은 뒤에 저장된 값을 읽습니다 - 그리는 도중에 읽으면 서버의 첫
 * 그림과 달라져 하이드레이션 오류(#418)가 납니다.
 */
export function usePersisted<T>(key: string, initial: T, encode: (v: T) => string = JSON.stringify, decode: (s: string) => T = JSON.parse): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(initial);
  const ready = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setV(decode(raw));
    } catch {
      /* 못 읽으면 기본값 */
    }
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!ready.current) return;
    try {
      localStorage.setItem(key, encode(v));
    } catch {
      /* 못 쓰면 이번 창에서만 기억 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v]);
  return [v, setV];
}
