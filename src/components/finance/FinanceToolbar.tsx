"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useFinanceFilter } from "@/components/finance/FinanceFilterProvider";
import MonthPicker from "@/components/finance/MonthPicker";

/**
 * **재무 화면 위의 한 줄** — 검색 · 달 · 고정 학생 · 최근 본 학생.
 *
 * 화면마다 따로 있던 검색칸과 달 고르개를 여기 한 곳으로 모았습니다. 탭을 옮겨도 이 줄은 그대로
 * 있고, 적힌 조건도 그대로입니다. 학비에서 「김에스더」를 찾아 놓고 학비외·학생별 회계·미납으로
 * 옮겨도 김에스더만 보입니다.
 *
 * `/` 를 누르면 검색칸으로 갑니다. 손이 키보드에 있을 때 마우스로 칸을 찾아가지 않게 합니다.
 */

/** 달이 뜻을 갖는 화면. 다른 화면(요금표·항목 등)에서 달 고르개를 띄우면 「이걸 바꾸면 뭐가 바뀌지」가 됩니다. */
const MONTH_PAGES = ["/finance", "/finance/ledger", "/finance/tuition", "/finance/payments"];
/** 검색이 뜻을 갖는 화면(학생 목록이 있는 곳). */
const SEARCH_PAGES = [
  "/finance/ledger",
  "/finance/tuition",
  "/finance/invoices",
  "/finance/unpaid",
  "/finance/payments",
  "/finance/send",
];

export default function FinanceToolbar() {
  const pathname = usePathname() ?? "";
  const f = useFinanceFilter();
  const box = useRef<HTMLInputElement | null>(null);
  const showMonth = MONTH_PAGES.includes(pathname);
  const showSearch = SEARCH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      box.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!showMonth && !showSearch) return null;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
      {showSearch && f.recent.length > 0 && !f.pinned && (
        <span className="hidden items-center gap-1 xl:flex" title="최근 본 학생 — 누르면 그 아이만 봅니다">
          {f.recent.slice(0, 4).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => f.pin(r)}
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-800"
            >
              {r.name}
            </button>
          ))}
        </span>
      )}
      {showSearch && f.pinned && (
        <span className="flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white" title="이 아이만 봅니다 — 어느 탭으로 가도 그대로입니다">
          📌 {f.pinned.name}
          <button type="button" onClick={() => f.pin(null)} className="ml-0.5 rounded-full px-1 hover:bg-amber-600" aria-label="고정 풀기">
            ✕
          </button>
        </span>
      )}
      {showSearch && (
        <span className="relative">
          <input
            ref={box}
            value={f.q}
            onChange={(e) => f.setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && f.setQ("")}
            placeholder="이름·영문·초성·반·청구서번호  /"
            className="w-56 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[12px] focus:border-emerald-500 focus:outline-none"
          />
          {f.q && (
            <button type="button" onClick={() => f.setQ("")} className="absolute right-1.5 top-1 text-[12px] text-slate-400 hover:text-slate-700" aria-label="검색 지우기">
              ✕
            </button>
          )}
        </span>
      )}
      {showMonth && (
        <MonthPicker
          value={f.month}
          thisMonth={f.thisMonth}
          onChange={f.setMonth}
          allowAll={pathname === "/finance/payments" || pathname === "/finance"}
        />
      )}
    </span>
  );
}
