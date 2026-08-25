"use client";

import { usePathname, useRouter } from "next/navigation";

// 하원 체크표 하위 탭(요청: "하원체크표도 탭을 나눠서 하원체크표와 하원셔틀명단을 설정하게").
// 체크표(매일 운영)와 셔틀명단 설정(어느 차에 누가 무슨 요일에 타는지)을 오갑니다.
export default function ChecklistSubTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = [
    { key: "check", label: "📋 하원 체크표", href: "/shuttle/checklist" },
    { key: "roster", label: "🚌 하원 셔틀명단", href: "/shuttle/checklist/roster" },
  ];
  const active = pathname?.startsWith("/shuttle/checklist/roster") ? "roster" : "check";
  return (
    <div className="mb-3 flex items-center gap-1 border-b border-slate-200 print:hidden">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => router.push(t.href)}
          onMouseEnter={() => router.prefetch(t.href)}
          className={
            "-mb-px rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors " +
            (active === t.key
              ? "border-b-2 border-blue-600 text-blue-700"
              : "border-b-2 border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
