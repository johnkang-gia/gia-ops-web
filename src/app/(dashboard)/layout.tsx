import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import SignOutButton from "@/components/SignOutButton";
import { SidebarNavLinks, MobileNavLinks, type NavCategory } from "@/components/NavLinks";
import MainArea from "@/components/MainArea";
import DateTimeCard from "@/components/home/DateTimeCard";
import GlobalSearchBar from "@/components/GlobalSearchBar";

// 메뉴를 "카테고리" 단위로 재구성했습니다(이전에는 세로로 긴 그룹 목록이라 계속 스크롤해야
// 했는데, 지금은 주메뉴 몇 개만 보이고 하위 항목은 마우스를 올리면 오른쪽으로 펼쳐집니다).
// accent는 이 카테고리가 어느 "앱"에 속하는지 색으로 알려줍니다: 홈/운영 관리=네이비(GIA ops),
// 업무=블루(WorkFlatform), 학교관리=퍼플, 주간 학생 관찰기록=틸, 지원·관리/개발자=앰버·레드.
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
      { href: "/proposals", label: "제안함", icon: "📝" },
      { href: "/adopted", label: "채택예정", icon: "📬" },
      { href: "/manuals", label: "매뉴얼", icon: "📖" },
      { href: "/documents", label: "서류함", icon: "📁" },
    ],
  };
}

// "학교관리" - 학생/반/학기/교직원(교사·관리자 등 계정) 관리를 한곳에 모았습니다. 예전에는
// 학기가 운영관리에도, 위클리 리포트 하위에도 중복으로 있었고 학생 관리도 두 군데(학생 명부 ·
// 학생 정보 조회)에 흩어져 있어 헷갈렸는데, 여기 하나로 통합했습니다. 반/과목/학생 명부/사용자
// 관리는 관리자만, 학기와 학생 정보 조회는 행정직원 이상 누구나 볼 수 있습니다(기존 권한 그대로).
function buildSchoolCategory(isAdmin: boolean, isStaffOrAbove: boolean): NavCategory {
  const items = [];
  if (isStaffOrAbove) items.push({ href: "/students", label: "학생 정보 조회", icon: "🔎" });
  if (isAdmin) {
    items.push(
      { href: "/weekly-report/admin/students", label: "학생 관리", labelEn: "Manage Students", icon: "🧑‍🎓" },
      { href: "/weekly-report/admin/classes", label: "반 관리", labelEn: "Manage Classes", icon: "🏫" },
      { href: "/weekly-report/admin/subjects", label: "과목반 세팅", labelEn: "Manage Subjects", icon: "📘" }
    );
  }
  items.push({ href: "/terms", label: "학기 관리", icon: "🗓️" });
  if (isAdmin) items.push({ href: "/admin/users", label: "사용자 관리", icon: "🔐" });
  return { key: "school", label: "학교 관리", icon: "🏛️", accent: "purple", items };
}

function buildWeeklyReportCategory(isAdmin: boolean): NavCategory {
  const items = [
    { href: "/weekly-report/students", label: "반별 작성 현황", labelEn: "Class Status", icon: "🎓" },
    { href: "/weekly-report/print", label: "리포트 프린트", labelEn: "Print Reports", icon: "🖨️" },
  ];
  if (isAdmin) {
    items.push({ href: "/weekly-report/admin/stats", label: "통계 대시보드", labelEn: "Statistics", icon: "📊" });
  }
  return { key: "weekly", label: "주간 학생 관찰기록", labelEn: "Weekly Student Reports", icon: "📈", accent: "teal", items };
}

// "지원 · 관리" - 학생/반/학기/계정 관리는 학교관리로 옮겼고, 여기는 관리자 대시보드(통합
// 현황판)와 문의및건의사항만 남았습니다.
function buildSupportCategory(isAdmin: boolean): NavCategory {
  const items = [];
  if (isAdmin) {
    items.push({ href: "/admin/dashboard", label: "관리자 대시보드", icon: "📊" });
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
  // getCurrentAppUser()는 React cache()로 감싸져 있어서, 이 아래에서 렌더링되는 각 페이지가
  // 같은 정보를 또 조회하려 해도(예: 학생 조회/관리자 화면의 권한 체크) 같은 요청 안에서는
  // 실제 DB 조회 없이 이 결과를 그대로 재사용합니다 - 탭을 옮길 때마다 두 번 묻던 것을 한 번으로.
  const [me, currentTerm] = await Promise.all([getCurrentAppUser(), getCurrentTerm(supabase)]);

  // middleware.ts가 1차로 막지만, 서버 컴포넌트 단에서도 한 번 더 확인합니다(방어적 이중 확인).
  if (!me) {
    redirect("/login");
  }

  const displayName = me.name || me.email;
  const isAdmin = isDeveloperEmail(me.email) || me.position === "관리자";
  const isTeacher = !isDeveloperEmail(me.email) && me.position === "교사";
  const isStaffOrAbove = isAdmin || me.position === "행정직원";
  const isDeveloper = isDeveloperEmail(me.email);
  // 뱃지는 우리 권한 체계의 실제 값(position)을 그대로 보여줍니다 - 자유 입력이 아니라 관리자가
  // [사용자 관리]에서 지정한 값입니다. 개발자 계정은 position과 무관하게 항상 "개발자"로 표시됩니다.
  const badgeLabel = isDeveloper ? "개발자" : me.position;

  const termLabel = currentTerm ? `${currentTerm.year} ${currentTerm.term_type}` : null;
  const homeHref = isTeacher ? "/weekly-report" : "/home";

  // 교사는 GIA ops/업무 등 다른 메뉴를 아예 볼 수 없고 위클리 리포트만 보입니다(계약직으로
  // 짧게 근무할 수도 있어 내부 문서 성격의 다른 메뉴를 감춥니다 - middleware.ts에서 실제
  // 접근 자체도 막습니다). 관리자/행정직원/개발자는 기존 메뉴 전체 + 위클리 리포트를 함께 봅니다.
  let categories: NavCategory[];
  if (isTeacher) {
    categories = [
      { key: "homeroom", label: "내 담임반", labelEn: "My Homeroom", icon: "🏠", href: "/weekly-report/homeroom", accent: "teal" },
      { key: "subjects", label: "내 담당과목", labelEn: "My Subjects", icon: "📘", href: "/weekly-report/subjects", accent: "teal" },
    ];
  } else {
    categories = [
      // "홈" 메뉴는 없앴습니다 - 왼쪽 로고(사이드바)/상단 로고(모바일)를 누르면 항상 홈으로
      // 이동하므로(아래 homeHref), 메뉴에 따로 자리를 차지할 필요가 없습니다.
      // 업무가 가장 자주 쓰는 메인 화면이라 맨 위로 올렸고, 전화 응대 중 바로 열어야 하는
      // 실무자 매뉴얼을 바로 그 아래에 뒀습니다.
      { key: "work", label: "업무", icon: "🗂️", href: "/work", accent: "blue" },
      { key: "staff-manual", label: "실무자 매뉴얼", icon: "📚", href: "/staff-manual", accent: "amber" },
      buildOpsCategory(),
      buildSchoolCategory(isAdmin, isStaffOrAbove),
    ];
    if (isStaffOrAbove) categories.push(buildWeeklyReportCategory(isAdmin));
    categories.push(buildSupportCategory(isAdmin));
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
          <Link
            href="/account"
            className="mt-2 flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50"
          >
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-slate-100">
              {me.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.avatar_url} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-300">
                  {displayName[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 truncate text-xs font-semibold text-slate-700">
                <span className="truncate">{displayName}</span>
                {badgeLabel && <span className="shrink-0 text-slate-400">({badgeLabel})</span>}
              </div>
              <div className="truncate text-[11px] text-slate-400">{me.email}</div>
            </div>
          </Link>
        </div>

        {/* 통합 검색 - 학생/사건/회의/행사/업무/서류를 메뉴를 옮겨다니지 않고 바로 찾습니다(요청). */}
        <div className="mb-3 shrink-0">
          <GlobalSearchBar />
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
        <div className="border-b border-slate-200 bg-white px-3 py-2 sm:hidden">
          <GlobalSearchBar compact />
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 sm:hidden">
          <MobileNavLinks categories={categories} />
        </nav>
        <MainArea>{children}</MainArea>
      </div>
    </div>
  );
}
