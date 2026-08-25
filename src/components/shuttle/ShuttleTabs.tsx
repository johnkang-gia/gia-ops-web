"use client";

import { usePathname, useRouter } from "next/navigation";

// 셔틀 전체를 "개요 + 탭" 하나의 대시보드처럼 묶는 공통 탭바입니다(요청: 메뉴 여러 개를
// 마우스 올려야 보이는 플라이아웃 대신, 페이지 상단 탭으로 늘 보이게). 모든 셔틀 페이지
// 최상단에 이 탭바를 두면, 좌측 메뉴를 헤매지 않고 탭으로 바로 오갑니다. 여러 하위 경로는
// 하나의 탭으로 묶어 강조합니다(예: 노선관리·탑승배정·배차표 → "노선·배정").
const TABS: { key: string; label: string; icon: string; href: string; match: string[] }[] = [
  { key: "overview", label: "개요", icon: "📊", href: "/shuttle/overview", match: ["/shuttle/overview"] },
  { key: "checklist", label: "하원 체크표", icon: "📋", href: "/shuttle/checklist", match: ["/shuttle/checklist"] },
  { key: "routes", label: "노선·배정·배차표", icon: "🛣️", href: "/shuttle", match: ["/shuttle", "/shuttle/routes", "/shuttle/students", "/shuttle/regions", "/shuttle/live"] },
  { key: "devices", label: "링크·기기·GPS", icon: "🔗", href: "/shuttle/pilot", match: ["/shuttle/pilot", "/shuttle/track-test"] },
  { key: "records", label: "기록·분석", icon: "⏱️", href: "/shuttle/stop-times", match: ["/shuttle/stop-times"] },
];

function activeKey(pathname: string | null): string {
  if (!pathname) return "overview";
  // 더 구체적인(경로가 긴) 매치를 우선합니다.
  let best = "overview";
  let bestLen = -1;
  for (const t of TABS) {
    for (const m of t.match) {
      if ((pathname === m || pathname.startsWith(m + "/") || (m === "/shuttle" && pathname === "/shuttle")) && m.length > bestLen) {
        best = t.key;
        bestLen = m.length;
      }
    }
  }
  return best;
}

export default function ShuttleTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeKey(pathname);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-slate-200 print:hidden">
      <span className="mr-2 text-base font-extrabold text-gia-navy">🚌 셔틀</span>
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
                ? "border-b-2 border-gia-navy text-gia-navy"
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
