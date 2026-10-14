"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FINANCE_SCOPE_COOKIE } from "@/lib/financeScope";

/**
 * 회계 범위(전체 · 초등 · 중고등)를 화면 사이에 들고 다닙니다.
 *
 * 쿠키에 적는 이유: 재무 화면은 서버가 자료를 골라 그립니다. 서버가 읽을 수 있는 자리여야
 * 범위 밖의 학생을 **처음부터 안 보냅니다** - 화면에서 가리는 것으로는 섞임이 남습니다.
 *
 * 처음 값은 서버가 쿠키에서 읽어 넘깁니다. 화면이 그리는 도중에 쿠키를 직접 읽으면 서버와
 * 브라우저의 첫 그림이 달라져 하이드레이션 오류(#418)가 납니다.
 */
type Ctx = { scope: string; scopes: string[]; setScope: (s: string, goTo?: string) => void };

const FinanceScopeContext = createContext<Ctx | null>(null);

export function FinanceScopeProvider({
  initialScope,
  scopes,
  children,
}: {
  initialScope: string;
  scopes: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [scope, setState] = useState(initialScope);

  const setScope = useCallback(
    (next: string, goTo?: string) => {
      if (!scopes.includes(next)) return;
      // 1년. 담당자는 대개 자기 부서 장부만 봅니다 - 다음에 열어도 그 장부여야 합니다.
      document.cookie = `${FINANCE_SCOPE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
      setState(next);
      if (goTo) router.push(goTo);
      // 서버가 범위에 맞는 자료를 다시 고르게 합니다.
      router.refresh();
    },
    [router, scopes],
  );

  const value = useMemo(() => ({ scope, scopes, setScope }), [scope, scopes, setScope]);
  return <FinanceScopeContext.Provider value={value}>{children}</FinanceScopeContext.Provider>;
}

/** 재무 열쇠가 없는 사람에게는 null 입니다. */
export function useFinanceScope(): Ctx | null {
  return useContext(FinanceScopeContext);
}
