"use client";

import { usePathname, useRouter } from "next/navigation";

// 업무 대분류를 "개요 + 탭" 하나의 관제탑처럼 묶는 상단 고정 탭바(요청: 업무 메뉴만 띄워두고도
// 모든 상황을 확인·처리). '기록'(사건·회의·행사·제안) 대분류를 업무 안 탭으로 흡수했습니다(7→5).
const TABS: { key: string; label: string; icon: string; href: string; match: string[] }[] = [
  // 개요 탭은 뺐습니다(요청: "업무개요는 업무 대시보드 있으니까 필요없고") - 업무 보드 자체가
  // 통합 인박스·흐름판을 갖춘 관제탑이므로 보드가 첫 탭입니다.
  { key: "board", label: "업무 보드", icon: "🗂️", href: "/work", match: ["/work"] },
  { key: "report", label: "보고서", icon: "📈", href: "/work/report", match: ["/work/report", "/meetings/report"] },
  { key: "records", label: "기록", icon: "📋", href: "/ops", match: ["/ops", "/records", "/meetings", "/events", "/records/drive"] },
  { key: "proposals", label: "제안·채택", icon: "📝", href: "/proposals", match: ["/proposals", "/adopted", "/ai-manual"] },
  { key: "archive", label: "보관", icon: "🗃️", href: "/work/history", match: ["/work/history", "/work/trash"] },
];

function activeKey(pathname: string | null): string {
  if (!pathname) return "board";
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
  return best || "board";
}

export default function WorkTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeKey(pathname);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-slate-200 print:hidden">
      <span className="mr-2 text-base font-extrabold text-blue-700">🗂️ 업무</span>
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
                ? "border-b-2 border-blue-600 text-blue-700"
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
