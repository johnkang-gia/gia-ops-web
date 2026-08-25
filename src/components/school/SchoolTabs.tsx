"use client";

import { usePathname, useRouter } from "next/navigation";

// 학교 대분류를 "개요 + 탭" 하나의 대시보드처럼 묶는 공통 탭바(요청: 모든 메뉴를 셔틀과 같은
// 개요+탭 구조로). 학교 관련 화면은 여러 경로에 흩어져 있어(학생/교직원/명부/반/학사일정 등)
// 레이아웃 하나로 못 감싸므로, 각 페이지 상단에 이 탭바를 둡니다. 탭 클릭은 Next.js 소프트
// 내비게이션이라 전체 새로고침 없이 전환됩니다.
const TABS: { key: string; label: string; icon: string; href: string; match: string[] }[] = [
  { key: "overview", label: "개요", icon: "📊", href: "/school/overview", match: ["/school/overview"] },
  { key: "students", label: "학생 조회", icon: "🎓", href: "/students", match: ["/students"] },
  { key: "staff", label: "교직원", icon: "🧑‍💼", href: "/staff", match: ["/staff"] },
  // 사이드바 서브메뉴와 항상 같은 항목·같은 순서입니다(요청: "상단탭이랑 서브메뉴랑 일치").
  { key: "roster", label: "명부 관리", icon: "📇", href: "/weekly-report/admin/students", match: ["/weekly-report/admin/students"] },
  { key: "classes", label: "반·과목", icon: "🏫", href: "/weekly-report/admin/classes", match: ["/weekly-report/admin/classes", "/weekly-report/admin/subjects"] },
  { key: "timetable", label: "수업·시간표", icon: "🗓️", href: "/school/timetable", match: ["/school/timetable"] },
  { key: "calendar", label: "학사일정", icon: "📅", href: "/academic-calendar", match: ["/academic-calendar"] },
  { key: "duty", label: "당번표", icon: "🍚", href: "/school/duty", match: ["/school/duty"] },
  { key: "prep", label: "학기 준비", icon: "🧭", href: "/academic-calendar/prep", match: ["/academic-calendar/prep"] },
];

function activeKey(pathname: string | null): string {
  if (!pathname) return "overview";
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
  return best || "overview";
}

export default function SchoolTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeKey(pathname);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-slate-200 print:hidden">
      <span className="mr-2 text-base font-extrabold text-purple-700">🏛️ 학교</span>
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
                ? "border-b-2 border-purple-600 text-purple-700"
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
