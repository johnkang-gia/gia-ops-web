"use client";

import { useEffect, useState } from "react";

// 사무실 대형 모니터에 띄우는 화면용 시계입니다(요청: "대시보드 분말고 초까지 나오도록 해줘").
//
// 시각을 서버 응답에서 받아 쓰면 갱신 주기(30초/10초)마다만 바뀌어서 초가 뚝뚝 끊깁니다.
// 그래서 화면 쪽에서 1초마다 직접 돌립니다. 노트북 시간대 설정과 무관하게 항상 한국시간으로
// 보이도록 UTC에 +9시간을 더해 계산합니다(앱의 다른 곳과 같은 방식).
//
// 서버 렌더링과 첫 클라이언트 렌더가 달라지면 hydration 경고가 나므로, 처음에는 null을
// 돌려주고 마운트된 뒤부터 값을 채웁니다. 쓰는 쪽에서 `clock ?? 서버가 준 시각`처럼 쓰면
// 깜빡임 없이 자연스럽게 이어집니다.
export function useKstClock(): string | null {
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    function tick() {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const hh = String(kst.getUTCHours()).padStart(2, "0");
      const mm = String(kst.getUTCMinutes()).padStart(2, "0");
      const ss = String(kst.getUTCSeconds()).padStart(2, "0");
      setClock(`${hh}:${mm}:${ss}`);
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  return clock;
}
