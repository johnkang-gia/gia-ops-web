import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isDeveloperEmail } from "@/lib/roles";
import SignOutButton from "@/components/SignOutButton";
import { SidebarNavLinks, MobileNavLinks, type NavCategory } from "@/components/NavLinks";
import MainArea from "@/components/MainArea";
import DateTimeCard from "@/components/home/DateTimeCard";

// 메뉴를 "카테고리" 단위로 재구성했습니다(이전에는 세로로 긴 그룹 목록이라 계속 스크롤해야
// 했는데, 지금은 주메뉴 몇 개만 보이고 하위 항목은 마우스를 올리면 오른쪽으로 펼쳐집니다).
// accent는 이 카테고리가 어느 "앱"에 속하는지 색으로 알려줍니다: 홈/운영 관리=네이비(GIA ops),
// 업무=블루(WorkFlatform), 위클리 리포트=틸, 지원·관리/개발자=앰버·레드.
function buildOpsCategory(): NavCategory {
  return {
    key: "ops",
    label: "운영 관리",
    icon: "📋",
    accent: "navy",
    items: [
      { href: "/records", label: "사건기록", icon: "📋" },
      { href: "/meetings", label: "회의기록", icon: "💬" },
      { href: "/ai-manual", label: "AI 매뉴얼", icon: "✨" },
      { href: "/events", label: "행사기록", icon: "🎉" },
      { href: "/terms", label: "학기", icon: "📅" },
      { href: "/proposals", label: "제안함", icon: "📝" },
      { href: "/adopted", label: "채택예정", icon: "📬" },
      { href: "/manuals", label: "매뉴얼", icon: "📖" },
      { href: "/documents", label: "서류함", icon: "📁" },
    ],
  };
}

function buildWeeklyReportCategory(isAdmin: boolean): NavCategory {
  const items = [
    { href: "/weekly-report/students", label: "학생 현황", icon: "🎓" },
    { href: "/weekly-report/print", label: "리포트 프린트", icon: "🖨️" },
  ];
  if (isAdmin) {
    items.push(
      { href: "/weekly-report/admin/classes", label: "반/담임 배정", icon: "🏫" },
      { href: "/weekly-report/admin/subjects", label: "과목반 세팅", icon: "📘" },
      { href: "/weekly-report/admin/students", label: "학생 명부", icon: "🧑‍🎓" },
      { href: "/terms", label: "학기 관리", icon: "🗓️" },
      { href: "/weekly-report/admin/stats", label: "통계 대시보드", icon: "📊" }
    );
  }
  return { key: "weekly", label: "위클리 리포트", icon: "📈", accent: "teal", items };
}

// "지원 · 관리" - 문의및건의사항은 행정직원 이상 누구나, 사용자 관리/관리자 대시보드는 관리자만,
// 학생 정보 조회는 행정직원/관리자(+개발자)만. 예전에는 각각 다른 메뉴 그룹에 흩어져 있어
// 스크롤을 계속 내려야 보였는데, 여기 하나로 모으고 맨 뒤로 옮겼습니다.
function buildSupportCategory(isAdmin: boolean, isStaffOrAbove: boolean): NavCategory {
  const items = [];
  if (isAdmin) {
    items.push({ href: "/admin/dashboard", label: "관리자 대시보드", icon: "📊" });
    items.push({ href: "/admin/users", label: "사용자 관리", icon: "🔐" });
  }
  if (isStaffOrAbove) {
    items.push({ href: "/students", label: "학생 정보 조회", icon: "🔎" });
  }
  items.push({ href: "/inquiries", label: "문의및건의사항", icon: "🗣️" });
  return { key: "support", label: "지원 · 관리", icon: "🛠️", accent: "amber", items };
}

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
  const isStaffOrAbove = isAdmin || appUser?.position === "행정직원";
  const isDeveloper = isDeveloperEmail(user.email);

  const termLabel = currentTerm ? `${currentTerm.year} ${currentTerm.term_type}` : null;
  const homeHref = isTeacher ? "/weekly-report" : "/home";

  // 교사는 GIA ops/업무 등 다른 메뉴를 아예 볼 수 없고 위클리 리포트만 보입니다(계약직으로
  // 짧게 근무할 수도 있어 내부 문서 성격의 다른 메뉴를 감춥니다 - middleware.ts에서 실제
  // 접근 자체도 막습니다). 관리자/행정직원/개발자는 기존 메뉴 전체 + 위클리 리포트를 함께 봅니다.
  let categories: NavCategory[];
  if (isTeacher) {
    categories = [
      { key: "homeroom", label: "내 담임반", icon: "🏠", href: "/weekly-report/homeroom", accent: "teal" },
      { key: "subjects", label: "내 담당과목", icon: "📘", href: "/weekly-report/subjects", accent: "teal" },
    ];
  } else {
    categories = [
      { key: "home", label: "홈", icon: "🏠", href: "/home", accent: "navy" },
      // 전화 응대 중 바로 열어야 하는 메뉴라 운영관리 하위에 묻지 않고 홈-업무 사이에 따로 뺐습니다.
      { key: "staff-manual", label: "실무자 매뉴얼", icon: "📚", href: "/staff-manual", accent: "amber" },
      { key: "work", label: "업무", icon: "🗂️", href: "/work", accent: "blue" },
      buildOpsCategory(),
    ];
    if (isStaffOrAbove) categories.push(buildWeeklyReportCategory(isAdmin));
    categories.push(buildSupportCategory(isAdmin, isStaffOrAbove));
    if (isDeveloper) {
      categories.push({ key: "dev", label: "개발자", icon: "🧑‍💻", href: "/dev", accent: "red" });
    }
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
          <div className="mt-1 truncate text-xs text-slate-400">{displayName}</div>
        </div>

        {/* 달력+시계를 축소판으로 항상 띄워둡니다(메뉴 스크롤에 밀리지 않도록 nav 바깥, shrink-0). */}
        <div className="mb-3 shrink-0 border-b border-slate-100 pb-3">
          <DateTimeCard compact />
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-visible">
          <SidebarNavLinks categories={categories} />
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
          <MobileNavLinks categories={categories} />
        </nav>
        <MainArea>{children}</MainArea>
      </div>
    </div>
  );
}
