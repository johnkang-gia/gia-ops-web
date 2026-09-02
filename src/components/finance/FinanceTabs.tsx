"use client";

import { usePathname, useRouter } from "next/navigation";

// 재무 하위 탭. 다른 대분류(업무·학교·셔틀)와 같은 모양으로 맞춥니다 - 화면마다 다르게
// 생기면 사람이 매번 "여기선 어디를 눌러야 하지"를 다시 배웁니다.
//
// 순서는 **자주 여는 것부터**입니다. 개요를 먼저 두는 이유는, 재무 일은 대개 "지금 어디까지
// 됐나"를 보는 데서 시작하기 때문입니다.
const TABS = [
  { key: "overview", label: "📊 개요", href: "/finance" },
  { key: "invoices", label: "🧾 인보이스 명단", href: "/finance/invoices" },
  { key: "items", label: "📚 학비외 항목", href: "/finance/items" },
  { key: "plans", label: "💵 납부 항목 · 할인", href: "/finance/plans" },
];

export default function FinanceTabs() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const active =
    pathname.startsWith("/finance/invoices") ? "invoices"
    : pathname.startsWith("/finance/items") ? "items"
    : pathname.startsWith("/finance/plans") ? "plans"
    : "overview";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200 print:hidden">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => router.push(t.href)}
          onMouseEnter={() => router.prefetch(t.href)}
          className={
            "-mb-px rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors " +
            (active === t.key
              ? "border-b-2 border-teal-600 text-teal-700"
              : "border-b-2 border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
