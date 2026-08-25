"use client";

import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/components/common/LanguageProvider";

// 교사 화면을 "개요 + 탭" 하나의 대시보드처럼 묶는 상단 고정 탭바(요청: 운영앱과 마찬가지로
// 상단탭 고정으로 이동). 담임 선생님과 과목 선생님이 보는 탭이 다릅니다.
export default function TeacherTabs({ isHomeroom }: { isHomeroom: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();

  const tabs: { key: string; label: string; icon: string; href: string; match: string[] }[] = isHomeroom
    ? [
        { key: "overview", label: t("우리 반 개요", "My Class"), icon: "🏫", href: "/my-class", match: ["/my-class"] },
        { key: "report", label: t("주간 리포트", "Weekly Report"), icon: "📝", href: "/weekly-report/homeroom", match: ["/weekly-report/homeroom", "/weekly-report/students"] },
        { key: "pickup", label: t("우리 반 픽업", "Pickup Check"), icon: "🚗", href: "/pickup", match: ["/pickup"] },
        { key: "office", label: t("행정실 문의", "Office Request"), icon: "💬", href: "/my-class/office", match: ["/my-class/office"] },
      ]
    : [
        { key: "overview", label: t("내 시간표", "My Schedule"), icon: "🗓️", href: "/my-class", match: ["/my-class"] },
        { key: "office", label: t("행정실 문의", "Office Request"), icon: "💬", href: "/my-class/office", match: ["/my-class/office"] },
      ];

  // /my-class/office 가 /my-class 로도 매칭되므로 가장 긴 일치를 활성으로 잡습니다.
  let active = tabs[0]?.key ?? "overview";
  let bestLen = -1;
  for (const tab of tabs) {
    for (const m of tab.match) {
      if ((pathname === m || (pathname ?? "").startsWith(m + "/")) && m.length > bestLen) {
        active = tab.key;
        bestLen = m.length;
      }
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-slate-200 print:hidden">
      <span className="mr-2 text-base font-extrabold text-teal-700">👩‍🏫 {t("교사", "Teacher")}</span>
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => router.push(tab.href)}
            onMouseEnter={() => router.prefetch(tab.href)}
            className={
              "relative -mb-px rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors " +
              (on
                ? "border-b-2 border-teal-600 text-teal-700"
                : "border-b-2 border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800")
            }
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
