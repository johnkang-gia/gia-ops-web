"use client";

import { useFinanceLive } from "@/lib/useFinanceLive";

/**
 * 아무것도 그리지 않고 **다시 읽기만** 담당합니다.
 *
 * 재무 개요·월별은 서버 컴포넌트라 훅을 직접 못 씁니다. 그렇다고 그 화면만 실시간에서
 * 빼면, 옆에서 금액을 고쳐도 그 두 화면은 옛 숫자를 그대로 보여줍니다 - 하필 그 둘이
 * **합계를 보는 화면**이라 가장 위험합니다.
 */
export default function FinanceLive() {
  useFinanceLive();
  return null;
}
