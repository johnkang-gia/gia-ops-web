import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isDeveloperEmail } from "@/lib/roles";
import SignOutButton from "@/components/SignOutButton";
import { SidebarNavLinks, MobileNavLinks } from "@/components/NavLinks";

// 메뉴를 목적별로 묶었습니다:
// - 홈/실무자매뉴얼: 매일 가장 자주 쓰는 화면(홈 확인, 학부모 문의 답변용 검색)이라 맨 위.
// - 자료 기록: 사건·회의·AI매뉴얼은 전부 "실무자매뉴얼/운영계획안을 만들기 위한 재료"라는
//   같은 목적을 가지므로 한 그룹으로 묶었습니다.
// - 행사: 사건/회의와 달리 매뉴얼 제작이 아니라 "반복되는 행사를 중복 없이 기록하고, 다음
//   행사를 준비할 때 참고"하는 것이 목적이라 별도 그룹으로 분리했습니다.
// - 제안·발행 워크플로우: 위 자료들이 실제 문서로 만들어지는 승인 단계.
// - 문서함: 최종 결과물(매뉴얼·서류) 보관/편집.
// - 관리: 시스템 운영(승인 관리).
const NAV_GROUPS = [
  {
    items: [
      { href: "/home", label: "홈", icon: "🏠" },
      { href: "/work", label: "업무", icon: "🗂️" },
      { href: "/staff-manual", label: "실무자매뉴얼", icon: "📚" },
    ],
  },
  {
    label: "자료 기록 (매뉴얼 재료)",
    items: [
      { href: "/records", label: "사건기록", icon: "📋" },
      { href: "/meetings", label: "회의기록", icon: "💬" },
      { href: "/ai-manual", label: "AI 매뉴얼", icon: "✨" },
    ],
  },
  {
    label: "행사 · 학기",
    items: [
      { href: "/events", label: "행사기록", icon: "🎉" },
      { href: "/terms", label: "학기", icon: "📅" },
    ],
  },
  {
    label: "제안 · 발행",
    items: [
      { href: "/proposals", label: "제안함", icon: "📝" },
      { href: "/adopted", label: "채택예정", icon: "📬" },
    ],
  },
  {
    label: "문서함",
    items: [
      { href: "/manuals", label: "매뉴얼", icon: "📖" },
      { href: "/documents", label: "서류함", icon: "📁" },
    ],
  },
  {
    label: "지원",
    items: [{ href: "/inquiries", label: "문의및건의사항", icon: "🗣️" }],
  },
  {
    label: "관리",
    items: [{ href: "/admin/users", label: "사용자 관리", icon: "🔐" }],
  },
];

// 개발자(johnkang@giamicro.com)에게만 보이는 그룹입니다. 아래에서 조건부로 NAV_GROUPS 끝에 붙입니다.
const DEVELOPER_NAV_GROUP = {
  label: "개발자",
  items: [{ href: "/dev", label: "개발자 대시보드", icon: "🛠️" }],
};

// 위클리 리포트(학생 주간 리포트) - 교직원 이상(교직원/관리자/개발자)에게 보이는 열람 메뉴.
// 교사는 이 그룹이 아니라 아래 TEACHER_NAV_GROUPS(자기 반/과목만)로 완전히 별도 처리됩니다.
const WEEKLY_REPORT_VIEW_GROUP = {
  label: "위클리 리포트",
  items: [
    { href: "/weekly-report/students", label: "학생 현황", icon: "🎓" },
    { href: "/weekly-report/print", label: "리포트 프린트", icon: "🖨️" },
  ],
};

// 관리자(또는 개발자) 전용 - 반/과목/학생명부/학기 세팅 + 통계.
const WEEKLY_REPORT_ADMIN_GROUP = {
  label: "위클리 리포트 관리",
  items: [
    { href: "/weekly-report/admin/classes", label: "반/담임 배정", icon: "🏫" },
    { href: "/weekly-report/admin/subjects", label: "과목반 세팅", icon: "📘" },
    { href: "/weekly-report/admin/students", label: "학생 명부", icon: "🧑‍🎓" },
    { href: "/weekly-report/admin/terms", label: "학기 관리", icon: "🗓️" },
    { href: "/weekly-report/admin/stats", label: "통계 대시보드", icon: "📊" },
  ],
};

// 교사 전용 사이드바 - 계약직으로 짧게 근무할 수도 있는 교사에게는 GIA ops/업무 등 내부
// 문서 성격의 다른 메뉴를 아예 보여주지 않고, 위클리 리포트 작성 화면만 보여줍니다.
const TEACHER_NAV_GROUPS = [
  {
    items: [
      { href: "/weekly-report/homeroom", label: "내 담임반", icon: "🏠" },
      { href: "/weekly-report/subjects", label: "내 담당과목", icon: "📘" },
    ],
  },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    currentTerm,
  ] = await Promise.all([supabase.auth.getUser(), getCurrentTerm(supabase)]);

  // middleware.ts가 1차로 막지만, 서버 컴포넌트 단에서도 한 번 더 확인합니다(방어적 이중 확인).
  if (!user) {
    redirect("/login");
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("name, position")
    .eq("email", (user.email ?? "").toLowerCase())
    .maybeSingle();
  const displayName = appUser?.name || user.email;
  const isAdmin = isDeveloperEmail(user.email) || appUser?.position === "관리자";
  const isTeacher = !isDeveloperEmail(user.email) && appUser?.position === "교사";
  const isStaffOrAbove = isAdmin || appUser?.position === "교직원";

  const termLabel = currentTerm ? `${currentTerm.year} ${currentTerm.term_type}` : null;
  const homeHref = isTeacher ? "/weekly-report" : "/home";

  // 교사는 GIA ops/업무 등 다른 메뉴를 아예 볼 수 없고 위클리 리포트만 보입니다(계약직으로
  // 짧게 근무할 수도 있어 내부 문서 성격의 다른 메뉴를 감춥니다 - middleware.ts에서 실제
  // 접근 자체도 막습니다). 관리자/교직원/개발자는 기존 메뉴 전체 + 위클리 리포트를 함께 봅니다.
  let navGroups: typeof NAV_GROUPS;
  if (isTeacher) {
    navGroups = TEACHER_NAV_GROUPS;
  } else {
    // "관리" 메뉴는 관리자 직위(또는 개발자)에게만 보입니다 - 승인 권한이 없는 사람에게는 애초에
    // 메뉴 자체를 감춰 혼란을 줄입니다(실제 접근 제한은 RLS가 최종적으로 보장).
    let groups = isAdmin ? NAV_GROUPS : NAV_GROUPS.filter((g) => g.label !== "관리");
    if (isStaffOrAbove) groups = [...groups, WEEKLY_REPORT_VIEW_GROUP];
    if (isAdmin) groups = [...groups, WEEKLY_REPORT_ADMIN_GROUP];
    navGroups = isDeveloperEmail(user.email) ? [...groups, DEVELOPER_NAV_GROUP] : groups;
  }

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 sm:flex sm:flex-col">
        <div className="mb-6 px-2">
          <Link href={homeHref} className="inline-block cursor-pointer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-main.png" alt="GIA Micro Lab" className="h-10 w-auto" />
          </Link>
          {!isTeacher &&
            (termLabel ? (
              <Link
                href="/terms"
                className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
              >
                📅 {termLabel}
              </Link>
            ) : (
              <div className="mt-2 text-[11px] text-slate-300">진행중인 학기 없음</div>
            ))}
          <div className="mt-1 truncate text-xs text-slate-400">
            {displayName}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          <SidebarNavLinks groups={navGroups} />
        </nav>
        <div className="border-t border-slate-200 pt-3">
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
          <Link href={homeHref} className="inline-block cursor-pointer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-main.png" alt="GIA Micro Lab" className="h-7 w-auto" />
          </Link>
          {!isTeacher &&
            (termLabel ? (
              <Link
                href="/terms"
                className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
              >
                📅 {termLabel}
              </Link>
            ) : (
              <span className="text-[11px] text-slate-300">진행중인 학기 없음</span>
            ))}
          <SignOutButton />
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 sm:hidden">
          <MobileNavLinks groups={navGroups} />
        </nav>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
