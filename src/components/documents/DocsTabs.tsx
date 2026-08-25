"use client";

import { usePathname, useRouter } from "next/navigation";

// 문서·매뉴얼 대분류의 상단 고정 탭바. 사이드바 서브메뉴와 항상 같은 항목·같은 순서입니다
// (요청: "상단탭이랑 서브메뉴랑 일치해야해"). 사건·회의·행사 기록과 제안·채택도 여기 속합니다.
const TABS: { key: string; label: string; icon: string; href: string; match: string[] }[] = [
  { key: "manual", label: "실무자 매뉴얼", icon: "📚", href: "/staff-manual", match: ["/staff-manual", "/manuals"] },
  { key: "docs", label: "문서함", icon: "🗄️", href: "/school/documents", match: ["/school/documents", "/documents"] },
  { key: "drive", label: "기록 드라이브", icon: "🗄️", href: "/records/drive", match: ["/records/drive"] },
  { key: "incidents", label: "사건", icon: "🗂️", href: "/ops", match: ["/ops", "/records"] },
  { key: "meetings", label: "회의", icon: "💬", href: "/meetings", match: ["/meetings"] },
  { key: "events", label: "행사", icon: "🎉", href: "/events", match: ["/events"] },
  { key: "proposals", label: "제안·채택", icon: "📝", href: "/proposals", match: ["/proposals", "/adopted", "/ai-manual"] },
];

function activeKey(pathname: string | null): string {
  if (!pathname) return "manual";
  let best = "";
  let bestLen = -1;
  for (const t of TABS) {
    for (const m of t.match) {
      if ((pathname === m || pathname.startsWith(m + "/")) && m.length > bestLen) {
        best = t.key;
        bestLen = m.length;
      }
    }
  }
  return best || "manual";
}

export default function DocsTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeKey(pathname);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-slate-200 print:hidden">
      <span className="mr-2 text-base font-extrabold text-amber-700">📚 문서 · 기록</span>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => router.push(t.href)}
            onMouseEnter={() => router.prefetch(t.href)}
            className={
              "relative -mb-px rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors " +
              (on
                ? "border-b-2 border-amber-600 text-amber-700"
                : "border-b-2 border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800")
            }
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
