import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail, isAdminUser, isTeacherOnly, isStaffOrAboveUser } from "@/lib/roles";
import SignOutButton from "@/components/SignOutButton";
import RolePreviewDropdown from "@/components/dev/RolePreviewDropdown";
import { SidebarNavLinks, MobileNavLinks, type NavCategory, type NavLeaf } from "@/components/NavLinks";
import MainArea from "@/components/MainArea";
import DateTimeCard from "@/components/home/DateTimeCard";
import GlobalSearchBar from "@/components/GlobalSearchBar";
import PausedFeaturesBanner from "@/components/dev/PausedFeaturesBanner";
import NotificationBell, { NotificationProvider, TaskCountBadge } from "@/components/NotificationBell";
import { APP_VERSION } from "@/lib/version";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ConfirmProvider } from "@/components/common/ConfirmProvider";
import ConnectionBanner from "@/components/common/ConnectionBanner";
import CommandPalette from "@/components/common/CommandPalette";
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
    // 부메뉴 항목이 많아 목적별로 구분선을 넣었습니다(요청: "부메뉴들도 구분에 맞게... 구분선으로
    // 구분해주고") - 기록(사건/회의/회의보고서/행사) → AI 매뉴얼(작성 도구) → 검토·발행(제안함/
    // 채택예정) 순서입니다. "매뉴얼"(조회/편집) 항목은 뺐습니다(메뉴 통합 제안 채택 #1) - 학교
    // 문서함 부메뉴에 매뉴얼/운영계획안 진입점이 이미 있어 여기 있으면 같은 화면(/manuals)으로
    // 가는 입구가 두 군데로 겹쳤습니다.
    items: [
      { href: "/records", label: "사건기록", icon: "📋" },
      { href: "/meetings", label: "회의기록", icon: "💬" },
      { href: "/meetings/report", label: "회의 보고서", icon: "📊" },
      { href: "/events", label: "행사기록", icon: "🎉" },
      { href: "/ai-manual", label: "AI 매뉴얼", icon: "✨", dividerBefore: "AI 매뉴얼" },
      { href: "/proposals", label: "제안함", icon: "📝", badge: pendingProposals, dividerBefore: "검토 · 발행" },
      { href: "/adopted", label: "채택예정", icon: "📬", badge: pendingAdopted },
    ],
  };
}

// "학교관리" - 학생/반/학기/교직원(교사·관리자 등 계정) 관리를 한곳에 모았습니다. 예전에는
// 학기가 운영관리에도, 위클리 리포트 하위에도 중복으로 있었고 학생 관리도 두 군데(학생 명부 ·
// 학생 정보 조회)에 흩어져 있어 헷갈렸는데, 여기 하나로 통합했습니다. 반/과목/학생 명부/사용자
// 관리는 관리자만, 학기와 학생 정보 조회는 행정직원 이상 누구나 볼 수 있습니다(기존 권한 그대로).
// "구글시트로 가져오기"는 부메뉴에서 뺐습니다(요청: "부메뉴에 구글시트로 가져오기 빼줘 어차피
// 학교관리 대시보드 위에 있으니까") - /school 화면(학교 관리 카테고리를 클릭하면 바로 가는
// 대시보드) 안에 이미 진입 카드가 있어서 부메뉴에 중복으로 둘 필요가 없습니다.
function buildSchoolCategory(isAdmin: boolean, isStaffOrAbove: boolean): NavCategory {
  const items: NavCategory["items"] = [];
  if (isStaffOrAbove) items!.push({ href: "/students", label: "학생 정보 조회", icon: "🔎" });
  if (isAdmin) {
    items!.push(
      { href: "/weekly-report/admin/students", label: "학생 관리", labelEn: "Manage Students", icon: "🧑‍🎓", dividerBefore: "명부 관리" },
      { href: "/weekly-report/admin/classes", label: "반 관리", labelEn: "Manage Classes", icon: "🏫" },
      { href: "/weekly-report/admin/subjects", label: "과목반 세팅", labelEn: "Manage Subjects", icon: "📘" }
    );
  }
  items!.push({ href: "/terms", label: "학기 관리", icon: "🗓️", dividerBefore: items!.length > 0 ? "" : undefined });
  if (isAdmin) items!.push({ href: "/admin/users", label: "사용자 관리", icon: "🔐", dividerBefore: "계정" });
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
      { href: "/documents", label: "서류함", icon: "📁", dividerBefore: "" },
      // 운영계획안/매뉴얼의 고정 항목 목록을 관리자·행정직원이 직접 추가/수정/삭제하는
      // 화면입니다(요청: "모든 항목들은 편집 가능하도록"). GIA시스템과 달리 관리자 전용이
      // 아니라 여기(행정직원도 보이는 문서함 부메뉴)에 둡니다.
      { href: "/admin/policy-categories", label: "정책 항목 관리", icon: "🗂️", dividerBefore: "" },
      // GIA시스템도 편집 권한이 관리자·행정직원까지 넓어졌으므로(요청: "관리자·행정직원까지"),
      // 관리자 전용이던 buildAdminCategory()에서 이쪽(행정직원도 보이는 문서함 부메뉴)으로
      // 옮겼습니다.
      { href: "/admin/gia-systems", label: "GIA시스템", icon: "🧩" },
    ],
  };
}

function buildWeeklyReportCategory(isAdmin: boolean): NavCategory {
  const items: NavLeaf[] = [
    { href: "/weekly-report/students", label: "반별 작성 현황", labelEn: "Class Status", icon: "🎓" },
    { href: "/weekly-report/print", label: "리포트 프린트", labelEn: "Print Reports", icon: "🖨️" },
  ];
  if (isAdmin) {
    items.push({ href: "/weekly-report/admin/stats", label: "통계 대시보드", labelEn: "Statistics", icon: "📊", dividerBefore: "관리자용" });
  }
  return { key: "weekly", label: "주간 학생 관찰기록", labelEn: "Weekly Student Reports", icon: "📈", accent: "teal", items };
}

// "관리자" - 관리자(부이사장/이사장 등)만 보는 학교 발전 현황 메뉴입니다. 예전에 여기 있던
// "통합 대시보드"(반복 사건·학생 랭킹·월별 추이·부서별 완료율 분석)를 한때 /school(학교 관리
// 대시보드) 안으로 합쳤었는데, 관리자 전용 분석이 로스터 화면 맨 아래에 묻혀 찾기 어렵다는
// 요청("관리자 통합 대시보드가 없어졌어, 관리자 페이지에서 관리자만 볼 수 있게")에 따라 다시
// 독립된 화면(/admin/dashboard)으로 분리했습니다. "학교 현황판"(/school)과는 별개 주소라 두
// 메뉴가 함께 하이라이트되는 예전 문제 없이 안전하게 추가할 수 있습니다. 다른 국제학교/공립
// 학교와 비교해 GIA가 어떤 시스템을 갖췄고 뭘 더 갖춰야 하는지 한눈에 보는 GIA시스템, 국제교육
// 관련 소식을 주 2회(월/수) AI가 정리해주는 교육뉴스, 데이터 백업도 여기 모았습니다. 문의및
// 건의사항은 관리자 전용이 아니라 모든 직원이 쓰는 기능이라 이 카테고리에서 빼고 사이드바 맨
// 아래에 작은 링크로 따로 둡니다.
function buildAdminCategory(): NavCategory {
  return {
    key: "admin",
    label: "관리자",
    icon: "🏢",
    accent: "amber",
    items: [
      { href: "/admin/dashboard", label: "통합 대시보드", icon: "📊" },
      { href: "/admin/education-news", label: "교육뉴스", icon: "📰" },
      { href: "/admin/backups", label: "데이터 백업", icon: "💾", dividerBefore: "" },
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
  // 크래시 방지(요청: "크러시 방지... 방법들을 제안해줘"): 검토대기 배지 숫자는 부가정보일 뿐이라,
  // 이 두 조회 중 하나가 네트워크 순간 장애 등으로 실패해도 로그인 여부(me) 확인과 화면 전체가
  // 함께 죽어서는 안 됩니다. Promise.all 대신 allSettled로 서로 독립시키고, 배지 조회가 실패하면
  // 0으로 조용히 대체합니다(사용자에게는 배지가 잠깐 안 보이는 정도의 영향만).
  const [meResult, pendingProposalsResult, pendingAdoptedResult] = await Promise.allSettled([
    getCurrentAppUser(),
    supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "검토대기"),
    supabase.from("adopted").select("id", { count: "exact", head: true }).eq("publish", false),
  ]);
  if (meResult.status === "rejected") throw meResult.reason;
  const me = meResult.value;
  const pendingProposals = pendingProposalsResult.status === "fulfilled" ? (pendingProposalsResult.value.count ?? 0) : 0;
  const pendingAdopted = pendingAdoptedResult.status === "fulfilled" ? (pendingAdoptedResult.value.count ?? 0) : 0;

  // middleware.ts가 1차로 막지만, 서버 컴포넌트 단에서도 한 번 더 확인합니다(방어적 이중 확인).
  if (!me) {
    redirect("/login");
  }

  const displayName = me.name || me.email;
  // 요청("테마구현 : 라이트(지금), 다크, 리퀴드글라스, GIA")에 따라 계정에 저장된 테마를
  // 공용 셸(사이드바/헤더/카드)에만 적용합니다("전체 공통 틀만") - 업무/위클리 리포트 등
  // 개별 화면 내부 색상은 그대로 둡니다. 서버 컴포넌트에서 바로 data-theme 속성으로
  // 렌더링하므로 클라이언트 깜빡임(하이드레이션 후 테마 전환) 없이 첫 페인트부터 적용됩니다.
  const theme = me.theme;
  const isAdmin = isAdminUser(me);
  const isTeacher = isTeacherOnly(me);
  const isStaffOrAbove = isStaffOrAboveUser(me);
  // email은 미리보기 중에도 절대 바뀌지 않으므로(@/lib/currentUser) isDeveloper는 언제나
  // "진짜 개발자 계정인지"를 뜻합니다 - 미리보기 드롭다운 노출 여부 등에 씁니다.
  const isDeveloper = isDeveloperEmail(me.email);
  // 권한 미리보기 중이면(요청: "그 권한에서만 볼 수 있는 화면으로") 개발자 전용 표시/메뉴를
  // 전부 감추고 그 직위가 실제로 보는 화면 그대로 재현합니다.
  const isPreviewing = !!me.previewOf;
  // 뱃지는 우리 권한 체계의 실제 값(position)을 그대로 보여줍니다 - 자유 입력이 아니라 관리자가
  // [사용자 관리]에서 지정한 값입니다. 개발자 계정은 미리보기 중이 아닐 때만 position과 무관하게
  // 항상 "개발자"로 표시됩니다.
  const badgeLabel = isDeveloper && !isPreviewing ? "개발자" : me.position;

  const homeHref = isTeacher ? "/weekly-report" : "/home";

  // 교사는 GIA ops/업무 등 다른 메뉴를 아예 볼 수 없고 위클리 리포트만 보입니다(계약직으로
  // 짧게 근무할 수도 있어 내부 문서 성격의 다른 메뉴를 감춥니다 - middleware.ts에서 실제
  // 접근 자체도 막습니다). 관리자/행정직원/개발자는 기존 메뉴 전체 + 위클리 리포트를 함께 봅니다.
  let categories: NavCategory[];
  if (isTeacher) {
    categories = [
      { key: "homeroom", label: "내 담임반", labelEn: "My Homeroom", icon: "🏠", href: "/weekly-report/homeroom", accent: "teal" },
      { key: "subjects", label: "내 담당과목", labelEn: "My Subjects", icon: "📘", href: "/weekly-report/subjects", accent: "teal" },
      // 학사일정은 교사에게는 감추고(요청: "교사권한은 학사일정 안보이게"), 대신 사물함 파손·
      // 물품 구입·아픈 학생 인계·출결 상황 문의처럼 행정직원에게 부탁할 일을 등록하는
      // "행정요청" 메뉴를 그 자리에 둡니다(요청: "교사는 행정부에... 요청하는 여러 일들").
      { key: "requests", label: "행정요청", labelEn: "Staff Requests", icon: "🧾", href: "/requests", accent: "teal" },
      // 출석부 메뉴는 요청("일단 지금 출석부를 쓸건 아니니까 출석부메뉴는 감춰줘")에 따라
      // 당분간 사이드바에서 숨겨둡니다. /attendance 화면 자체와 기능은 그대로 남아있어서,
      // 나중에 이 항목의 주석만 풀면 바로 다시 노출할 수 있습니다.
      // { key: "attendance", label: "출석부", labelEn: "Attendance", icon: "🗒️", href: "/attendance", accent: "teal" },
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
      // 학사일정달력(기존 화면)/학기준비(신규 - 지난 같은 학기 신청서·준비 기록 참고) 두 부메뉴로
      // 나뉩니다(요청: "학사일정에 '학사일정달력','학기준비' 부메뉴를 만들어서").
      {
        key: "academic-calendar",
        label: "학사일정",
        icon: "📅",
        accent: "teal",
        items: [
          { href: "/academic-calendar", label: "학사일정달력", icon: "📅" },
          { href: "/academic-calendar/prep", label: "학기준비", icon: "🧭" },
        ],
      },
      // 행정요청 메뉴는 여기(관리자/행정직원 등)에는 따로 두지 않습니다(요청: "행정요청메뉴는
      // 교사에게만 보이고, 나머지에게는 업무에 등록되는 것으로 알수있게 해줘") - 교사가 등록한
      // 요청은 자동으로 업무보드에도 등록되므로(요청 575), 업무 탭 안의 업무상황판 오른쪽에
      // 들어온 행정요청 건수가 뜨고 처리도 업무 확인/완료로 자동 동기화됩니다. /requests
      // 페이지 자체는 남아 있어(주소로 직접 접근하거나 업무상황판에서 링크로 들어갈 수 있음)
      // 전체 목록·상태변경도 그대로 가능합니다.
      buildOpsCategory(pendingProposals, pendingAdopted),
      buildSchoolCategory(isAdmin, isStaffOrAbove),
      buildSchoolDocumentsCategory(),
      // 출석부 메뉴는 요청("일단 지금 출석부를 쓸건 아니니까 출석부메뉴는 감춰줘")에 따라
      // 당분간 사이드바에서 숨겨둡니다. /attendance 화면 자체와 기능은 그대로 남아있어서,
      // 나중에 이 항목의 주석만 풀면 바로 다시 노출할 수 있습니다.
      // { key: "attendance", label: "출석부", labelEn: "Attendance", icon: "🗒️", href: "/attendance", accent: "teal" },
    ];
    if (isStaffOrAbove) categories.push(buildWeeklyReportCategory(isAdmin));
    if (isAdmin) categories.push(buildAdminCategory());
    if (isDeveloper && !isPreviewing) {
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
    <ToastProvider>
    <ConfirmProvider>
    <NotificationProvider userEmail={isTeacher ? null : me.email}>
    <div data-theme={theme} className="shell-page-bg relative flex h-screen flex-1">
      <ConnectionBanner />
      <CommandPalette categories={categories} homeHref={homeHref} />
      <aside className="shell-blur hidden w-56 shrink-0 border-r border-[var(--shell-border)] bg-[var(--shell-bg)] p-4 sm:flex sm:flex-col">
        <div className="mb-3 px-2">
          {/* 로고 아래 학기 표시를 가운데 정렬합니다(요청: "로고아래 학기표시 가운데정렬"). */}
          <div className="flex flex-col items-center text-center">
            <Link href={homeHref} className="inline-block cursor-pointer">
              <Image
                src="/logo-main.png"
                alt="GIA Micro Lab"
                width={538}
                height={120}
                priority
                className="shell-logo-mark h-10 w-auto"
              />
            </Link>
            {!isTeacher && (
              <Suspense fallback={<div className="mt-2 h-[22px] w-24 animate-pulse rounded-full bg-slate-100" />}>
                <TermBadge variant="desktop" />
              </Suspense>
            )}
          </div>
          {/* 업무 관련 표시 두 가지가 여기 붙습니다(요청: "동그라미 안의 숫자는 미확인 업무
              개수로 하고, 확인이 되면 프로필 이름 맨 오른쪽에 둥근 네모박스안에 총
              업무갯수를 표시해줘"): (1) 프로필 아이콘 왼쪽 위 모서리 - 미확인 업무가 있으면
              빨간 원이 깜빡임(NotificationBell), (2) 이름 줄 맨 오른쪽 - 내 업무 총 개수를
              보여주는 조용한 사각 배지(TaskCountBadge). 둘 다 클릭 가능한 별도 링크라(/work로
              이동), 프로필 자체 링크 안에 중첩되지 않도록 바깥 relative flex 행에 형제로
              둡니다. */}
          <div className="relative mt-2 flex items-center gap-1">
            <Link href="/account" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 hover:bg-[var(--shell-hover-bg)]">
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[var(--shell-hover-bg)]">
                {me.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.avatar_url} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-bold text-[var(--shell-text-muted)]">
                    {displayName[0]?.toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 truncate text-xs font-semibold text-[var(--shell-text)]">
                  <span className="truncate">{displayName}</span>
                  {badgeLabel && <span className="shrink-0 text-[var(--shell-text-muted)]">({badgeLabel})</span>}
                </div>
                <div className="truncate text-[11px] text-[var(--shell-text-muted)]">{me.email}</div>
              </div>
            </Link>
            {!isTeacher && <TaskCountBadge />}
            {!isTeacher && <NotificationBell />}
          </div>
          <Suspense fallback={null}>
            <DisabledFeaturesSection />
          </Suspense>
        </div>

        {/* 검색+달력을 한 상자로 합쳤습니다(요청: "프로필 아래 검색과 달력위젯을 합쳐줘 검색아래에
            달력있게"). 위쪽엔 통합 검색(학생/사건/회의/행사/업무/서류), 아래쪽엔 축소 달력을
            같은 테두리 안에 둬서 메뉴 영역을 더 넓게 확보했습니다(요청: "이 위젯 좀더 작게"). */}
        <div className="mb-2 shrink-0 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-card-bg)] p-1.5">
          <GlobalSearchBar compact />
          <div className="mt-1.5 border-t border-[var(--shell-border)] pt-1.5">
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
            className="mb-1 flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]"
          >
            🗣️ 문의및건의사항
          </Link>
        )}
        {/* 요청("현재 버전을 문의사항 아래에 표시해주고 어떤 버전에서 무엇이 개선되었는지
            버전로그 볼 수 있도록") - 누르면 /changelog로 이동합니다. */}
        <Link
          href="/changelog"
          className="mb-1 flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]"
        >
          🏷️ v{APP_VERSION}
        </Link>
        <div className="border-t border-[var(--shell-border)] pt-3">
          {/* 요청("개발자 계정의 경우 로그아웃 바로위에 드롭다운메뉴로 권한을 변경할 수 있게") -
              실제 개발자 계정에게만 보이고, 다른 직위는 이 드롭다운 자체를 볼 수 없습니다. */}
          {isDeveloper && <RolePreviewDropdown currentPreview={me.previewOf} />}
          <SignOutButton />
        </div>
      </aside>

      <div className="flex h-screen flex-1 flex-col">
        <header className="shell-blur flex items-center justify-between border-b border-[var(--shell-border)] bg-[var(--shell-bg)] px-4 py-3 sm:hidden">
          <Link href={homeHref} className="inline-block cursor-pointer">
            <Image src="/logo-main.png" alt="GIA Micro Lab" width={538} height={120} className="shell-logo-mark h-7 w-auto" />
          </Link>
          {!isTeacher && (
            <Suspense fallback={<span className="h-[22px] w-20 animate-pulse rounded-full bg-[var(--shell-hover-bg)]" />}>
              <TermBadge variant="mobile" />
            </Suspense>
          )}
          <div className="flex items-center gap-2">
            {/* 데스크톱 프로필 옆 배지와 같은 컴포넌트를 모바일에서는 계정 아이콘 옆에 둡니다. */}
            <div className="relative">
              <Link href="/account" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--shell-hover-bg)] text-xs font-bold text-[var(--shell-text-muted)]">
                {displayName[0]?.toUpperCase()}
              </Link>
              {!isTeacher && <NotificationBell />}
            </div>
            <SignOutButton />
          </div>
        </header>
        <div className="shell-blur border-b border-[var(--shell-border)] bg-[var(--shell-bg)] px-3 py-2 sm:hidden">
          <GlobalSearchBar compact />
        </div>
        <nav className="shell-blur flex items-center gap-1 overflow-x-auto border-b border-[var(--shell-border)] bg-[var(--shell-bg)] px-2 py-2 sm:hidden">
          <MobileNavLinks categories={categories} />
          {!isTeacher && (
            <Link href="/inquiries" className="ml-auto shrink-0 rounded-lg px-2 py-1.5 text-xs text-[var(--shell-text-muted)]">
              🗣️ 문의
            </Link>
          )}
        </nav>
        <MainArea>{children}</MainArea>
      </div>
    </div>
    </NotificationProvider>
    </ConfirmProvider>
    </ToastProvider>
  );
}
