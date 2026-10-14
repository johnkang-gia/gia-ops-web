"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_SCOPE, type Scope } from "@/lib/gradeScope";
import { FINANCE_MONTH_COOKIE, FINANCE_TERM_COOKIE } from "@/lib/financeFilter";

/**
 * **재무 화면들이 함께 쓰는 조건** — 검색어 · 학년·반 · 월 · 학기 · 고정 학생 · 최근 본 학생.
 *
 * ── 왜 화면마다 두지 않는가 ───────────────────────────────────────────
 *
 * 학비 일괄 발행·학비외 일괄 발행·학생별 회계가 저마다 검색칸과 학년·반·월 고르개를 들고
 * 있었습니다. 학비에서 한 아이를 찾아 놓고 학비외로 넘어가면 검색칸이 비어 있어 다시 쳐야
 * 했고, 돌아오면 또 비어 있었습니다. 한 아이의 일을 끝내려면 탭 이동 → 검색을 서너 번 반복합니다.
 *
 * 이 상자는 재무 레이아웃에 한 번 깔려서 화면을 옮겨도 사라지지 않습니다. 화면은 자기 상태를
 * 만들지 않고 여기서 읽습니다. 그래서 「탭을 옮겼더니 조건이 풀렸다」가 구조상 일어날 수 없습니다.
 *
 * 월·학기는 **쿠키에도 적습니다.** 학생별 회계·개요처럼 서버가 달을 골라 그리는 화면이 있어서,
 * 서버도 같은 달을 읽어야 화면마다 다른 달을 보는 일이 없습니다.
 *
 * 검색어·고정 학생은 이 창(탭)에만 남깁니다(sessionStorage). 두 창에서 다른 아이를 보는 일이
 * 흔해서, 한쪽의 검색이 다른 쪽을 덮으면 안 됩니다.
 */

export type PinnedStudent = { id: string; name: string };

type Ctx = {
  q: string;
  setQ: (q: string) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  /** 보고 있는 달(YYYY-MM). null 이면 「달을 안 가림」(수납 내역의 전체). */
  month: string | null;
  setMonth: (m: string | null) => void;
  /** 보고 있는 학기. 빈 글자면 화면이 정한 기본(진행중 학기). */
  termId: string;
  setTermId: (t: string) => void;
  pinned: PinnedStudent | null;
  pin: (s: PinnedStudent | null) => void;
  recent: PinnedStudent[];
  touch: (s: PinnedStudent) => void;
  /** 이 학생이 지금 조건(고정·검색)에 드는가. 학년·반은 화면이 따로 견줍니다. */
  thisMonth: string;
};

const FinanceFilterContext = createContext<Ctx | null>(null);
const STORE = "gia.finance.filters.v1";

function writeCookie(name: string, value: string | null) {
  document.cookie = value
    ? `${name}=${encodeURIComponent(value)}; path=/; max-age=2592000; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}

export function FinanceFilterProvider({
  initialMonth,
  initialTermId,
  thisMonth,
  children,
}: {
  /** 서버가 쿠키에서 읽은 달. 첫 그림이 서버와 같아야 하이드레이션이 어긋나지 않습니다. */
  initialMonth: string | null;
  initialTermId: string;
  thisMonth: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [q, setQState] = useState("");
  const [scope, setScopeState] = useState<Scope>(ALL_SCOPE);
  const [month, setMonthState] = useState<string | null>(initialMonth);
  const [termId, setTermIdState] = useState(initialTermId);
  const [pinned, setPinned] = useState<PinnedStudent | null>(null);
  const [recent, setRecent] = useState<PinnedStudent[]>([]);
  const loaded = useRef(false);

  // 이 창에서 보던 검색·고정 학생을 되살립니다. 그리는 도중이 아니라 붙은 뒤에 읽습니다 -
  // 그리는 도중에 읽으면 서버의 첫 그림과 달라져 하이드레이션 오류가 납니다.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE);
      if (raw) {
        const v = JSON.parse(raw) as { q?: string; scope?: Scope; pinned?: PinnedStudent | null; recent?: PinnedStudent[] };
        if (typeof v.q === "string") setQState(v.q);
        if (v.scope && typeof v.scope.grade === "string") setScopeState(v.scope);
        if (v.pinned?.id) setPinned(v.pinned);
        if (Array.isArray(v.recent)) setRecent(v.recent.filter((r) => r?.id).slice(0, 5));
      }
    } catch {
      // 저장소를 못 쓰는 창(사생활 보호 모드)이면 기억만 못 할 뿐 화면은 그대로 씁니다.
    }
    // 「조건 그대로 링크」로 열었으면 주소의 조건이 이깁니다(동료가 보낸 화면을 그대로 봅니다).
    try {
      const u = new URL(window.location.href);
      const fq = u.searchParams.get("fq");
      const fg = u.searchParams.get("fg");
      const fk = u.searchParams.get("fk");
      const fp = u.searchParams.get("fp");
      const fpn = u.searchParams.get("fpn");
      if (fq !== null) setQState(fq);
      if (fg !== null || fk !== null) setScopeState({ grade: fg ?? "", klass: fk ?? "" });
      if (fp && fpn) setPinned({ id: fp, name: fpn });
      const ym = u.searchParams.get("ym");
      if (ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) {
        setMonthState(ym);
        writeCookie(FINANCE_MONTH_COOKIE, ym);
      }
    } catch {
      /* 주소를 못 읽으면 저장된 조건 그대로 */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ q, scope, pinned, recent }));
    } catch {
      /* 위와 같음 */
    }
  }, [q, scope, pinned, recent]);

  const setMonth = useCallback(
    (m: string | null) => {
      setMonthState(m);
      writeCookie(FINANCE_MONTH_COOKIE, m ?? "all");
      // 서버가 달을 골라 그리는 화면(학생별 회계·개요)이 새 달로 다시 그립니다. 주소에 옛 달(?ym=)이
      // 붙어 있으면 그 달이 이기므로 떼어 냅니다.
      const url = new URL(window.location.href);
      if (url.searchParams.has("ym")) {
        url.searchParams.delete("ym");
        router.replace(url.pathname + (url.search ? url.search : ""));
      } else router.refresh();
    },
    [router],
  );
  const setTermId = useCallback(
    (t: string) => {
      setTermIdState(t);
      writeCookie(FINANCE_TERM_COOKIE, t || null);
    },
    [],
  );
  const touch = useCallback((s: PinnedStudent) => {
    setRecent((p) => [s, ...p.filter((x) => x.id !== s.id)].slice(0, 5));
  }, []);
  const pin = useCallback(
    (s: PinnedStudent | null) => {
      setPinned(s);
      if (s) touch(s);
    },
    [touch],
  );

  const value = useMemo<Ctx>(
    () => ({ q, setQ: setQState, scope, setScope: setScopeState, month, setMonth, termId, setTermId, pinned, pin, recent, touch, thisMonth }),
    [q, scope, month, setMonth, termId, setTermId, pinned, pin, recent, touch, thisMonth],
  );
  return <FinanceFilterContext.Provider value={value}>{children}</FinanceFilterContext.Provider>;
}

/**
 * 재무 화면이 조건을 읽는 곳. 재무 밖(인쇄본 등)에서 그려질 때를 위해 상자가 없으면 화면 안에서만
 * 쓰는 상태로 대신합니다 - 그래도 화면은 움직여야 합니다.
 */
export function useFinanceFilter(): Ctx {
  const ctx = useContext(FinanceFilterContext);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [month, setMonth] = useState<string | null>(null);
  const [termId, setTermId] = useState("");
  if (ctx) return ctx;
  return {
    q,
    setQ,
    scope,
    setScope,
    month,
    setMonth,
    termId,
    setTermId,
    pinned: null,
    pin: () => {},
    recent: [],
    touch: () => {},
    thisMonth: "",
  };
}
