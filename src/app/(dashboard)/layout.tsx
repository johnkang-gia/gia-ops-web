import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail, isAdminUser, isTeacherOnly, isStaffOrAboveUser } from "@/lib/roles";
import SignOutButton from "@/components/SignOutButton";
import { SidebarNavLinks, MobileNavLinks, type NavCategory } from "@/components/NavLinks";
import MainArea from "@/components/MainArea";
import DateTimeCard from "@/components/home/DateTimeCard";
import GlobalSearchBar from "@/components/GlobalSearchBar";
import PausedFeaturesBanner from "@/components/dev/PausedFeaturesBanner";
import NotificationBell from "@/components/NotificationBell";
import type { AiFeatureFlag } from "@/lib/types";

// 학기 배지 - 로그인 인증(me)과 달리 이 화면을 막을 이유가 없는 "장식성" 정보라서, layout
// 전체가 이 조회가 끝날 때까지 기다리지 않도록 별도 컴포넌트로 분리해 <Suspense>로 감쌌습니다
// (요청: "메뉴간 전환도 그렇고 화면이 바뀌는 것도 너무 느려 - 획기적으로 빠르게"). 예전에는
// getCurrentTerm()도 매 네비게이션마다 layout의 Promise.all 안에서 다른 4개 조회와 함께
// 무조건 끝나야만 사이드바 전체가 그려졌는데, 이제는 로고·메뉴·검색창은 즉시 뜨고 학기 배지만
// 살짝 늦게(스트리밍으로) 채워집니다. getCurrentTerm() 자체는 React cache()로 감싸져 있어
// 데스크톱/모바일 두 곳에서 각각 호출해도 실제 DB 조회는 요청당 1번만 나갑니다.
async function TermBadge({ variant }: { variant: "desktop" | "mobile" }) {
  const currentTerm = await getCurrentTerm();
  const termLabel = currentTerm ? `${currentTerm.year} ${currentTerm.term_type}` : null;

  if (variant === "mobile") {
    return termLabel ? (
      <Link href="/terms" className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
        📅 {termLabel}
      </Link>
    ) : (
      <span className="text-[11px] text-slate-300">진행중인 학기 없음</span>
    );
  }

  return termLabel ? (
    <Link
      href="/terms"
      className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
    >
      📅 {termLabel}
    </Link>
  ) : (
    <div className="mt-2 text-[11px] text-slate-300">진행중인 학기 없음</div>
  );
}

// AI 기능 일시정지 배너도 학기 배지와 같은 이유로 분리했습니다 - 개발자가 과금 조절을 위해
// 기능을 꺼둔 경우에만 보이는 드문 상황이라, 이 조회 때문에 매번 화면 전체가 늦어질 필요가
// 없습니다.
async function DisabledFeaturesSection() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_feature_flags")
    .select("*")
    .eq("enabled", false)
    .order("updated_at", { ascending: false });
  return <PausedFeaturesBanner disabledFeatures={(data as AiFeatureFlag[] | null) ?? []} />;
}

// 메뉴를 "카테고리" 단위로 재구성했습니다(이전에는 세로로 긴 그룹 목록이라 계속 스크롤해야
// 했는데, 지금은 주메뉴 몇 개만 보이고 하위 항목은 마우스를 올리면 오른쪽으로 펼쳐집니다).
// accent는 이 카테고리가 어느 "앱"에 속하는지 색으로 알려줍니다: 홈/운영 관리=네이비(GIA ops),
// 업무=블루(WorkFlatform), 학교관리=퍼플, 주간 학생 관찰기록=틸, 지원·관리/개발자=앰버·레드.
// pendingProposals/pendingAdopted - 제안함(검토대기)·채택예정(발행대기) 건수입니다. 예전에는
// 이 메뉴를 직접 열어봐야만 검토할 게 있는지 알 수 있었는데, 사이드바에서 바로 빨간 숫자로
// 보이도록 배지를 붙였습니다(요청: "검토 대기 배지 추가").
function buildOpsCategory(pendingProposals: number, pendingAdopted: number): NavCategory {
  return {
    key: "ops",
    label: "운영 관리",
    icon: "📋",
    accent: "navy",
    items: [
      { href: "/records", label: "사건기록", icon: "📋" },
      { href: "/meetings", label: "회의기록", icon: "💬" },
      { href: "/meetings/report", label: "회의 보고서", icon: "📊" },
      { href: "/ai-manual", label: "AI 매뉴얼", icon: "✨" },
      { href: "/events", label: "행사기록", icon: "🎉" },
      { href: "/proposals", label: "제안함", icon: "📝", badge: pendingProposals },
      { href: "/adopted", label: "채택예정", icon: "📬", badge: pendingAdopted },
      { href: "/manuals", label: "매뉴얼", icon: "📖" },
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
      { href: "/weekly-report/admin/subjects", label: "과목반 세팅", labelEn: "Manage Subjects", icon: "📘" },
      { href: "/school/import", label: "구글시트로 가져오기", labelEn: "Import from Google Sheets", icon: "📥" }
    );
  }
  items.push({ href: "/terms", label: "학기 관리", icon: "🗓️" });
  if (isAdmin) items.push({ href: "/admin/users", label: "사용자 관리", icon: "🔐" });
  return { key: "school", label: "학교 관리", icon: "🏛️", accent: "purple", href: "/school", items };
}

// "학교 문서함" - 예전에는 업무 보고서·회의 보고서·매뉴얼·운영계획안·서류함이 운영관리/업무 등
// 여러 메뉴에 흩어져 있어서, 구두로 처리되던 업무·회의를 문서로 정리해도 정작 어디서 다시
// 찾아보고 인쇄할지 한눈에 안 보였습니다(요청: "gia의 모든 서류와 보고서들을 통합 관리해서
// 이 메뉴에서 전부 인쇄하거나, 열람, 검색할 수 있도록"). 학교관리 바로 아래에 이 메뉴 하나를
// 두고, 열람·검색·인쇄가 필요한 문서류를 전부 여기로 모았습니다. 매뉴얼/운영계획안은 실제
// 작성·편집은 여전히 운영관리(채택예정 발행 워크플로우)에서 이뤄지지만, 열람·인쇄 진입점은
// 여기에도 부메뉴로 함께 둡니다. 서류함은 운영관리에서 완전히 이쪽으로 옮겼습니다.
function buildSchoolDocumentsCategory(): NavCategory {
  return {
    key: "school-documents",
    label: "학교 문서함",
    icon: "🗄️",
    accent: "purple",
    href: "/school/documents",
    items: [
      { href: "/school/documents", label: "문서함 홈", icon: "🗄️" },
      { href: "/school/documents/reports", label: "보고서 (업무·회의)", icon: "📊" },
      { href: "/manuals?doc=실무자용", label: "매뉴얼", icon: "📗" },
      { href: "/manuals?doc=학부모용", label: "운영계획안", icon: "📘" },
      { href: "/documents", label: "서류함", icon: "📁" },
    ],
  };
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

// "관리자" - 관리자(부이사장/이사장 등)만 보는 학교 발전 현황 메뉴입니다. 다른 국제학교/공립
// 학교와 비교해 GIA가 어떤 시스템을 갖췄고 뭘 더 갖춰야 하는지 한눈에 보는 GIA시스템, 국제교육
// 관련 소식을 주 2회(월/수) AI가 정리해주는 교육뉴스, 데이터 백업을 여기 모았습니다. "학교
// 현황판"(/school)은 "학교 관리" 카테고리 자체의 클릭 링크와 완전히 같은 주소라 여기 다시
// 넣으면 두 메뉴가 항상 같이 하이라이트돼 헷갈렸습니다(요청: "학교관리를 누르면 관리자가 같이
// 색이 바뀌고 ... 관리자메뉴를 눌러도 학교관리 메뉴가 같이 색이 바뀌어") - 학교 현황판은
// "학교 관리" 메뉴로 가면 되므로 여기서는 뺐습니다. 문의및건의사항은 관리자 전용이 아니라
// 모든 직원이 쓰는 기능이라 이 카테고리에서 빼고 사이드바 맨 아래에 작은 링크로 따로 둡니다.
function buildAdminCategory(): NavCategory {
  return {
    key: "admin",
    label: "관리자",
    icon: "🏢",
    accent: "amber",
    items: [
      { href: "/admin/education-news", label: "교육뉴스", icon: "📰" },
      { href: "/admin/gia-systems", label: "GIA시스템", icon: "🧩" },
      { href: "/admin/backups", label: "데이터 백업", icon: "💾" },
    ],
  };
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
  // layout이 실제로 "화면을 막고" 기다려야 하는 건 로그인 여부(me)와 검토대기 배지 숫자뿐이라,
  // 이 둘만 남기고 나머지(학기 배지·AI 기능 배너)는 위 TermBadge/DisabledFeaturesSection로
  // 분리해 <Suspense>로 스트리밍합니다(요청: "메뉴 전환이 너무 느려 - 획기적으로 빠르게").
  const [me, pendingProposalsRes, pendingAdoptedRes] = await Promise.all([
    getCurrentAppUser(),
    supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "검토대기"),
    supabase.from("adopted").select("id", { count: "exact", head: true }).eq("publish", false),
  ]);
  const pendingProposals = pendingProposalsRes.count ?? 0;
  const pendingAdopted = pendingAdoptedRes.count ?? 0;

  // middleware.ts가 1차로 막지만, 서버 컴포넌트 단에서도 한 번 더 확인합니다(방어적 이중 확인).
  if (!me) {
    redirect("/login");
  }

  const displayName = me.name || me.email;
  const isAdmin = isAdminUser(me);
  const isTeacher = isTeacherOnly(me);
  const isStaffOrAbove = isStaffOrAboveUser(me);
  const isDeveloper = isDeveloperEmail(me.email);
  // 뱃지는 우리 권한 체계의 실제 값(position)을 그대로 보여줍니다 - 자유 입력이 아니라 관리자가
  // [사용자 관리]에서 지정한 값입니다. 개발자 계정은 position과 무관하게 항상 "개발자"로 표시됩니다.
  const badgeLabel = isDeveloper ? "개발자" : me.position;

  const homeHref = isTeacher ? "/weekly-report" : "/home";

  // 교사는 GIA ops/업무 등 다른 메뉴를 아예 볼 수 없고 위클리 리포트만 보입니다(계약직으로
  // 짧게 근무할 수도 있어 내부 문서 성격의 다른 메뉴를 감춥니다 - middleware.ts에서 실제
  // 접근 자체도 막습니다). 관리자/행정직원/개발자는 기존 메뉴 전체 + 위클리 리포트를 함께 봅니다.
  let categories: NavCategory[];
  if (isTeacher) {
    categories = [
      { key: "homeroom", label: "내 담임반", labelEn: "My Homeroom", icon: "🏠", href: "/weekly-report/homeroom", accent: "teal" },
      { key: "subjects", label: "내 담당과목", labelEn: "My Subjects", icon: "📘", href: "/weekly-report/subjects", accent: "teal" },
      // 학사일정은 학기 시작/종료 전에 전 직원이 준비해야 할 일을 달력으로 보여주는
      // 화면이라, 정보 열람이 제한적인 교사 계정에도 예외적으로 노출합니다(요청: "모든
      // 직원들이 준비하고 체크할 수 있는").
      { key: "academic-calendar", label: "학사일정", icon: "📅", href: "/academic-calendar", accent: "teal" },
    ];
  } else {
    categories = [
      // "홈" 메뉴는 없앴습니다 - 왼쪽 로고(사이드바)/상단 로고(모바일)를 누르면 항상 홈으로
      // 이동하므로(아래 homeHref), 메뉴에 따로 자리를 차지할 필요가 없습니다.
      // 업무가 가장 자주 쓰는 메인 화면이라 맨 위로 올렸고, 전화 응대 중 바로 열어야 하는
      // 실무자 매뉴얼을 바로 그 아래에 뒀습니다.
      { key: "work", label: "업무", icon: "🗂️", href: "/work", accent: "blue" },
      { key: "staff-manual", label: "실무자 매뉴얼", icon: "📚", href: "/staff-manual", accent: "amber" },
      // 학사일정 - 학기 시작/종료 며칠 전에 뭘 준비해야 하는지를 달력으로 한눈에 보고 체크하는
      // 화면입니다(요청: "학기시작 2주전에뭘하고 1주전에 뭘하고 가 달력으로 한번에 보여서").
      { key: "academic-calendar", label: "학사일정", icon: "📅", href: "/academic-calendar", accent: "teal" },
      buildOpsCategory(pendingProposals, pendingAdopted),
      buildSchoolCategory(isAdmin, isStaffOrAbove),
      buildSchoolDocumentsCategory(),
    ];
    if (isStaffOrAbove) categories.push(buildWeeklyReportCategory(isAdmin));
    if (isAdmin) categories.push(buildAdminCategory());
    if (isDeveloper) {
      categories.push({ key: "dev", label: "개발자", icon: "🧑‍💻", href: "/dev", accent: "red" });
    }
  }

  return (
    // min-h-screen(최소 높이)이 아니라 h-screen(고정 높이)을 씁니다: min-height는 "이만큼은
    // 넘게"만 정할 뿐 실제 높이를 화면에 고정하지 않아서, 채팅처럼 내용이 계속 늘어나는 화면이
    // 있으면 이 바깥 틀 자체가 계속 늘어나며 브라우저 전체 페이지가 스크롤돼버립니다(요청:
    // "채팅을 계속치니까 채팅창이 아래로 쭉 내려가면서 메뉴랑 화면들이 전부 위로 올라가버려").
    // 높이를 화면 크기로 고정해야 그 안의 각 화면(예: 업무 탭 채팅)이 자기 영역 안에서만
    // 스크롤되고, 사이드바 메뉴는 항상 제자리에 그대로 있습니다.
    <div className="flex h-screen flex-1">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 sm:flex sm:flex-col">
        <div className="mb-3 px-2">
          {/* 로고 아래 학기 표시를 가운데 정렬합니다(요청: "로고아래 학기표시 가운데정렬"). */}
          <div className="flex flex-col items-center text-center">
            <Link href={homeHref} className="inline-block cursor-pointer">
              <Image src="/logo-main.png" alt="GIA Micro Lab" width={538} height={120} priority className="h-10 w-auto" />
            </Link>
            {!isTeacher && (
              <Suspense fallback={<div className="mt-2 h-[22px] w-24 animate-pulse rounded-full bg-slate-100" />}>
                <TermBadge variant="desktop" />
              </Suspense>
            )}
          </div>
          {/* 채팅에 새 글이 올라오거나 내 업무목록에 새 업무가 등록되면 여기 프로필 왼쪽 위에
              빨간 알림 배지가 뜹니다(요청: "메뉴항목 프로필 옆에 알람형식으로 알 수 있도록").
              배지 자체가 클릭 가능한 별도 링크라(/work로 이동), 안쪽에 또 링크를 두는
              마크업을 피하려고 감싸는 relative div를 하나 더 뒀습니다. */}
          <div className="relative mt-2">
            <Link href="/account" className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50">
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
            {!isTeacher && <NotificationBell userEmail={me.email} />}
          </div>
          <Suspense fallback={null}>
            <DisabledFeaturesSection />
          </Suspense>
        </div>

        {/* 검색+달력을 한 상자로 합쳤습니다(요청: "프로필 아래 검색과 달력위젯을 합쳐줘 검색아래에
            달력있게"). 위쪽엔 통합 검색(학생/사건/회의/행사/업무/서류), 아래쪽엔 축소 달력을
            같은 테두리 안에 둬서 메뉴 영역을 더 넓게 확보했습니다(요청: "이 위젯 좀더 작게"). */}
        <div className="mb-2 shrink-0 rounded-lg border border-slate-200 bg-slate-50/60 p-1.5">
          <GlobalSearchBar compact />
          <div className="mt-1.5 border-t border-slate-100 pt-1.5">
            <DateTimeCard compact />
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-visible">
          <SidebarNavLinks categories={categories} />
        </nav>
        {/* 문의및건의사항은 특정 부서/직급 전용 기능이 아니라 버그 제보·건의 창구라, 관리자
            메뉴에 묶지 않고 누구나 눈에 띄게 맨 아래에 작은 링크로 둡니다(교사는 애초에
            위클리 리포트 화면만 쓰므로 노출하지 않습니다). */}
        {!isTeacher && (
          <Link
            href="/inquiries"
            className="mb-1 flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600"
          >
            🗣️ 문의및건의사항
          </Link>
        )}
        <div className="border-t border-slate-200 pt-3">
          <SignOutButton />
        </div>
      </aside>

      <div className="flex h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
          <Link href={homeHref} className="inline-block cursor-pointer">
            <Image src="/logo-main.png" alt="GIA Micro Lab" width={538} height={120} className="h-7 w-auto" />
          </Link>
          {!isTeacher && (
            <Suspense fallback={<span className="h-[22px] w-20 animate-pulse rounded-full bg-slate-100" />}>
              <TermBadge variant="mobile" />
            </Suspense>
          )}
          <div className="flex items-center gap-2">
            {/* 데스크톱 프로필 옆 배지와 같은 컴포넌트를 모바일에서는 계정 아이콘 옆에 둡니다. */}
            <div className="relative">
              <Link href="/account" className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-400">
                {displayName[0]?.toUpperCase()}
              </Link>
              {!isTeacher && <NotificationBell userEmail={me.email} />}
            </div>
            <SignOutButton />
          </div>
        </header>
        <div className="border-b border-slate-200 bg-white px-3 py-2 sm:hidden">
          <GlobalSearchBar compact />
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 sm:hidden">
          <MobileNavLinks categories={categories} />
          {!isTeacher && (
            <Link href="/inquiries" className="ml-auto shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-400">
              🗣️ 문의
            </Link>
          )}
        </nav>
        <MainArea>{children}</MainArea>
      </div>
    </div>
  );
}
