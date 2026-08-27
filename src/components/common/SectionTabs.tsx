"use client";

import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/components/common/LanguageProvider";

// 대분류 상단 탭바 - 전 화면 공용 단 하나의 구현입니다.
//
// 예전에는 WorkTabs/SchoolTabs/DocsTabs/ShuttleTabs/TeacherTabs를 각 페이지가 자기 본문 안에서
// 직접 그렸습니다. 그런데 페이지마다 바깥 상자가 제각각이라(max-w-2xl / max-w-5xl / max-w-none,
// p-4 sm:p-6 / sm:p-8 / 패딩 없음) 같은 탭바인데도 화면을 옮길 때마다 왼쪽 시작점과 폭이 널뛰었고,
// 그래서 "폰트 크기·간격이 페이지별로 바뀌는 것처럼" 보였습니다(요청 ④).
//
// 이제는 대시보드 레이아웃이 본문(<MainArea>) 바로 위에서 이 컴포넌트를 한 번만 그립니다.
// 본문이 어떤 상자를 쓰든 탭바는 언제나 같은 자리·같은 크기·같은 간격입니다. 페이지는 탭바를
// 신경 쓸 필요가 없고, 탭 사이 이동도 레이아웃이 유지된 채 본문만 바뀌므로 더 빠릅니다.
export type TabDef = {
  key: string;
  label: string;
  labelEn?: string;
  icon: string;
  href: string;
  /** 이 탭이 활성으로 잡힐 경로들(가장 긴 일치가 이깁니다). */
  match: string[];
  /** 대분류 탭을 줄이면서 흡수한 화면들 - 활성일 때 아래 작은 줄로 펼칩니다. */
  children?: { label: string; labelEn?: string; href: string; match?: string[] }[];
};

type AccentKey = "blue" | "purple" | "navy" | "amber" | "teal";

// Tailwind는 문자열을 이어붙여 만든 클래스명을 빌드 시점에 알아보지 못하므로(그러면 그 색이
// 통째로 빠집니다) 조합을 하드코딩해 둡니다.
const ACCENT: Record<AccentKey, { title: string; on: string; subOn: string }> = {
  blue: { title: "text-blue-700", on: "border-blue-600 text-blue-700", subOn: "bg-blue-50 text-blue-700" },
  purple: { title: "text-purple-700", on: "border-purple-600 text-purple-700", subOn: "bg-purple-50 text-purple-700" },
  navy: { title: "text-gia-navy", on: "border-gia-navy text-gia-navy", subOn: "bg-slate-100 text-gia-navy" },
  amber: { title: "text-amber-700", on: "border-amber-600 text-amber-700", subOn: "bg-amber-50 text-amber-700" },
  teal: { title: "text-teal-700", on: "border-teal-600 text-teal-700", subOn: "bg-teal-50 text-teal-700" },
};

// ── 업무 ────────────────────────────────────────────────────────────────────
const WORK_TABS: TabDef[] = [
  { key: "board", label: "업무 보드", icon: "🗂️", href: "/work", match: ["/work"] },
  { key: "report", label: "보고서", icon: "📈", href: "/work/report", match: ["/work/report"] },
  { key: "history", label: "지난 업무", icon: "🗃️", href: "/work/history", match: ["/work/history"] },
  { key: "trash", label: "휴지통", icon: "🗑️", href: "/work/trash", match: ["/work/trash"] },
];

// ── 학교 ────────────────────────────────────────────────────────────────────
// 요청("학교메뉴도 길게 복잡해 - 통합·최적화해서 줄여줘")에 따라 9개를 5개로 합쳤습니다.
// 합치면서 사라진 화면은 없습니다. 성격이 같은 것끼리 묶고, 묶인 화면들은 그 탭이 활성일 때
// 바로 아래 작은 줄(children)로 펼쳐 한 번에 갈 수 있게 했습니다.
const SCHOOL_TABS: TabDef[] = [
  { key: "overview", label: "개요", icon: "📊", href: "/school/overview", match: ["/school/overview"] },
  {
    key: "students",
    label: "학생",
    icon: "🎓",
    href: "/students",
    match: ["/students", "/weekly-report/admin/students", "/school/data-check"],
    children: [
      { label: "학생 조회", href: "/students", match: ["/students"] },
      { label: "명부 관리", href: "/weekly-report/admin/students" },
      { label: "명부 점검", href: "/school/data-check" },
    ],
  },
  { key: "staff", label: "교직원", icon: "🧑‍💼", href: "/staff", match: ["/staff"] },
  {
    key: "classes",
    label: "반 · 시간표",
    icon: "🏫",
    href: "/weekly-report/admin/classes",
    match: ["/weekly-report/admin/classes", "/weekly-report/admin/subjects", "/school/timetable"],
    children: [
      { label: "반 관리", href: "/weekly-report/admin/classes" },
      { label: "과목", href: "/weekly-report/admin/subjects" },
      { label: "수업 시간표", href: "/school/timetable" },
    ],
  },
  {
    key: "academic",
    label: "학사운영",
    icon: "📅",
    href: "/academic-calendar",
    match: ["/academic-calendar", "/school/duty", "/terms"],
    children: [
      { label: "학사일정", href: "/academic-calendar", match: ["/academic-calendar"] },
      { label: "당번표", href: "/school/duty" },
      { label: "학기 준비", href: "/academic-calendar/prep" },
      { label: "학기 관리", href: "/terms" },
    ],
  },
];

// ── 셔틀 ────────────────────────────────────────────────────────────────────
const SHUTTLE_TABS: TabDef[] = [
  { key: "overview", label: "개요", icon: "📊", href: "/shuttle/overview", match: ["/shuttle/overview"] },
  { key: "checklist", label: "하원 체크표", icon: "📋", href: "/shuttle/checklist", match: ["/shuttle/checklist"] },
  { key: "pickup", label: "픽업 인박스", icon: "📥", href: "/pickup/inbox", match: ["/pickup/inbox"] },
  {
    key: "routes",
    label: "노선 · 배정",
    icon: "🛣️",
    href: "/shuttle",
    match: ["/shuttle", "/shuttle/routes", "/shuttle/students", "/shuttle/regions", "/shuttle/live"],
    children: [
      { label: "배차표", href: "/shuttle", match: ["/shuttle"] },
      { label: "노선 관리", href: "/shuttle/routes" },
      { label: "탑승 배정", href: "/shuttle/students" },
      { label: "지역별", href: "/shuttle/regions" },
      { label: "실시간", href: "/shuttle/live" },
    ],
  },
  {
    key: "devices",
    label: "링크 · 기기",
    icon: "🔗",
    href: "/shuttle/pilot",
    match: ["/shuttle/pilot", "/shuttle/track-test", "/shuttle/gps"],
    children: [
      { label: "링크 · 기기", href: "/shuttle/pilot", match: ["/shuttle/pilot"] },
      // 요청: "GPS 연결차를 따로 탭을 만들어서 쭉 볼 수 있게." 발급하는 곳과 지켜보는 곳을
      // 나눕니다 - 운행 중에는 카드가 아니라 한 줄씩 늘어선 표가 필요합니다.
      { label: "GPS 현황", href: "/shuttle/gps" },
    ],
  },
  { key: "records", label: "기록 · 분석", icon: "⏱️", href: "/shuttle/stop-times", match: ["/shuttle/stop-times"] },
];

// ── 문서 · 기록 ─────────────────────────────────────────────────────────────
// 학교와 같은 방식으로 17줄이던 사이드바를 7개 대분류로 줄이고, 흡수한 화면은 children으로
// 펼칩니다(요청: "통합, 최적화, 줄여줘" + "상단탭이랑 서브메뉴랑 일치해야해").
const DOCS_TABS: TabDef[] = [
  {
    key: "manual",
    label: "실무자 매뉴얼",
    icon: "📚",
    href: "/staff-manual",
    match: ["/staff-manual", "/manuals"],
    children: [
      { label: "실무자 매뉴얼", href: "/staff-manual", match: ["/staff-manual"] },
      { label: "매뉴얼 (실무자용)", href: "/manuals?doc=실무자용" },
      { label: "운영계획안 (학부모용)", href: "/manuals?doc=학부모용" },
    ],
  },
  {
    key: "docs",
    label: "문서함",
    icon: "🗄️",
    href: "/school/documents",
    match: ["/school/documents", "/documents"],
    children: [
      { label: "문서함 홈", href: "/school/documents", match: ["/school/documents"] },
      { label: "서류함", href: "/documents", match: ["/documents"] },
      { label: "AI 서류 작성", href: "/documents/new" },
      { label: "보고서 모음", href: "/school/documents/reports" },
    ],
  },
  { key: "drive", label: "기록 드라이브", icon: "🗃️", href: "/records/drive", match: ["/records/drive"] },
  {
    key: "incidents",
    label: "사건",
    icon: "🗂️",
    href: "/ops",
    match: ["/ops", "/records"],
    children: [
      { label: "등록사건목록", href: "/ops" },
      { label: "사건기록", href: "/records", match: ["/records"] },
    ],
  },
  {
    key: "meetings",
    label: "회의",
    icon: "💬",
    href: "/meetings",
    match: ["/meetings"],
    children: [
      { label: "회의기록", href: "/meetings", match: ["/meetings"] },
      { label: "회의 보고서", href: "/meetings/report" },
    ],
  },
  { key: "events", label: "행사", icon: "🎉", href: "/events", match: ["/events"] },
  {
    key: "proposals",
    label: "제안 · 채택",
    icon: "📝",
    href: "/proposals",
    match: ["/proposals", "/adopted", "/ai-manual"],
    children: [
      { label: "제안함", href: "/proposals" },
      { label: "채택예정", href: "/adopted" },
      { label: "AI 매뉴얼 작성", href: "/ai-manual" },
    ],
  },
];

type Section = { title: string; titleEn?: string; icon: string; accent: AccentKey; tabs: TabDef[] };

// pathname이 어느 대분류에 속하는지 고릅니다. 교사 계정은 아예 다른 탭 세트를 씁니다.
function sectionFor(pathname: string, opts: { isTeacher: boolean; isHomeroom: boolean }): Section | null {
  if (opts.isTeacher) {
    const teacherTabs: TabDef[] = opts.isHomeroom
      ? [
          { key: "overview", label: "우리 반 개요", labelEn: "My Class", icon: "🏫", href: "/my-class", match: ["/my-class"] },
          {
            key: "report",
            label: "주간 리포트",
            labelEn: "Weekly Report",
            icon: "📝",
            href: "/weekly-report/homeroom",
            match: ["/weekly-report/homeroom", "/weekly-report/students"],
          },
          { key: "pickup", label: "우리 반 픽업", labelEn: "Pickup Check", icon: "🚗", href: "/pickup", match: ["/pickup"] },
          { key: "office", label: "행정실 문의", labelEn: "Office Request", icon: "💬", href: "/my-class/office", match: ["/my-class/office"] },
        ]
      : [
          { key: "overview", label: "내 시간표", labelEn: "My Schedule", icon: "🗓️", href: "/my-class", match: ["/my-class"] },
          { key: "office", label: "행정실 문의", labelEn: "Office Request", icon: "💬", href: "/my-class/office", match: ["/my-class/office"] },
        ];
    const hit = teacherTabs.some((t) => t.match.some((m) => pathname === m || pathname.startsWith(m + "/")));
    return hit ? { title: "교사", titleEn: "Teacher", icon: "👩‍🏫", accent: "teal", tabs: teacherTabs } : null;
  }

  const sections: Section[] = [
    { title: "업무", icon: "🗂️", accent: "blue", tabs: WORK_TABS },
    { title: "학교", icon: "🏛️", accent: "purple", tabs: SCHOOL_TABS },
    { title: "셔틀", icon: "🚌", accent: "navy", tabs: SHUTTLE_TABS },
    { title: "문서 · 기록", icon: "📚", accent: "amber", tabs: DOCS_TABS },
  ];
  // 가장 구체적으로(경로가 길게) 맞는 대분류를 고릅니다. 예: /weekly-report/admin/students는
  // 학교에만 있고, /shuttle/checklist는 셔틀에만 있습니다.
  let best: Section | null = null;
  let bestLen = -1;
  for (const s of sections) {
    for (const t of s.tabs) {
      for (const m of t.match) {
        if ((pathname === m || pathname.startsWith(m + "/")) && m.length > bestLen) {
          best = s;
          bestLen = m.length;
        }
      }
    }
  }
  return best;
}

function activeTab(tabs: TabDef[], pathname: string): TabDef | null {
  let best: TabDef | null = null;
  let bestLen = -1;
  for (const t of tabs) {
    for (const m of t.match) {
      if ((pathname === m || pathname.startsWith(m + "/")) && m.length > bestLen) {
        best = t;
        bestLen = m.length;
      }
    }
  }
  return best;
}

export default function SectionTabs({ isTeacher, isHomeroom }: { isTeacher: boolean; isHomeroom: boolean }) {
  const t = useT();
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const section = sectionFor(pathname, { isTeacher, isHomeroom });
  if (!section) return null;

  const accent = ACCENT[section.accent];
  const active = activeTab(section.tabs, pathname);
  const subs = active?.children ?? [];

  // 하위 줄에서 지금 보고 있는 화면 - 여기서도 가장 긴 일치를 씁니다(/academic-calendar와
  // /academic-calendar/prep이 함께 있으므로).
  let activeSub = "";
  let subLen = -1;
  for (const c of subs) {
    for (const m of c.match ?? [c.href]) {
      if ((pathname === m || pathname.startsWith(m + "/")) && m.length > subLen) {
        activeSub = c.href;
        subLen = m.length;
      }
    }
  }

  return (
    // 전 화면 공통 고정 자리. 본문(<MainArea>)의 좌우 여백과 같은 px를 써서 탭과 페이지 내용의
    // 왼쪽 선이 항상 맞습니다. pb로 페이지 본문과의 간격도 확보합니다(요청: "업무탭부분 너무
    // 페이지랑 가까워 조금 여유는 줘").
    <div className="shrink-0 px-4 pt-3 sm:px-6 print:!hidden">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-slate-200">
        <span className={"mr-2 text-base font-extrabold " + accent.title}>
          {section.icon} {section.titleEn ? t(section.title, section.titleEn) : section.title}
        </span>
        {section.tabs.map((tab) => {
          const on = tab.key === active?.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => router.push(tab.href)}
              onMouseEnter={() => router.prefetch(tab.href)}
              className={
                "relative -mb-px rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors " +
                (on ? "border-b-2 " + accent.on : "border-b-2 border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800")
              }
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.labelEn ? t(tab.label, tab.labelEn) : tab.label}
            </button>
          );
        })}
      </div>

      {/* 대분류를 줄이면서 흡수한 화면들. 탭을 5개로 줄이되 어떤 화면도 사라지지 않게 합니다. */}
      {subs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-1.5">
          {subs.map((c) => {
            const on = c.href === activeSub;
            return (
              <button
                key={c.href}
                type="button"
                onClick={() => router.push(c.href)}
                onMouseEnter={() => router.prefetch(c.href)}
                className={
                  "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors " +
                  (on ? accent.subOn : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")
                }
              >
                {c.labelEn ? t(c.label, c.labelEn) : c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
