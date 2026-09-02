import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTerm } from "@/lib/currentTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail, isAdminUser, isTeacherOnly, isStaffOrAboveUser, hasFinanceAccess } from "@/lib/roles";
import SignOutButton from "@/components/SignOutButton";
import RolePreviewDropdown from "@/components/dev/RolePreviewDropdown";
import { SidebarNavLinks, MobileNavLinks, type NavCategory, type NavLeaf } from "@/components/NavLinks";
import MainArea from "@/components/MainArea";
import SectionTabs from "@/components/common/SectionTabs";
import DateTimeCard from "@/components/home/DateTimeCard";
import GlobalSearchBar from "@/components/GlobalSearchBar";
import PausedFeaturesBanner from "@/components/dev/PausedFeaturesBanner";
import NotificationBell, { NotificationProvider, TaskCountBadge } from "@/components/NotificationBell";
import { APP_VERSION } from "@/lib/version";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ConfirmProvider } from "@/components/common/ConfirmProvider";
import { LanguageProvider } from "@/components/common/LanguageProvider";
import LanguageToggle from "@/components/common/LanguageToggle";
import { getLang } from "@/lib/langServer";
import { makeT } from "@/lib/lang";
import { positionLabel } from "@/lib/i18nLabels";
import { isDemoAccount } from "@/lib/sharedAccounts";
import ConnectionBanner from "@/components/common/ConnectionBanner";
import CommandPalette from "@/components/common/CommandPalette";
import type { AiFeatureFlag } from "@/lib/types";

// 홈 화면에 추가했을 때 브라우저 주소창 없이 앱처럼 열리도록(standalone) 하는 최소 PWA
// 설정입니다. 로그인이 필요한 이 (dashboard) 영역에만 둡니다 - 루트에 두면 안내보드·도착체크
// 같은 로그인 없는 토큰 링크를 홈 화면에 추가할 때도 이 manifest를 따라가서, 그 링크가 아니라
// 앱 메인(manifest의 start_url)으로 등록돼버리는 문제가 있었습니다(요청: "이 링크 그대로는
// 아이콘 등록이 안돼").
export const metadata: Metadata = {
  manifest: "/manifest.json",
};

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

// 메뉴 구조 - 2026학년도 3학기를 앞두고 전면 재분류했습니다(요청: "이제 메뉴가 너무 많아져서
// 통합할거 통합하고 분류할건 분류하고 싶어... 주간학생관찰기록은 제외하고 나머지의 메뉴들을
// 최대한 통합하고 관리할 수 있도록 메뉴를 다시 분류해줘").
//
// 예전에는 주메뉴가 10개였습니다. 기능이 생길 때마다 최상위에 하나씩 붙인 결과라, "실무자
// 매뉴얼"과 "학교 문서함"처럼 성격이 같은 메뉴가 따로 떨어져 있고 "학사일정"처럼 항목이 두 개뿐인
// 메뉴도 최상위 한 칸을 차지하고 있었습니다. 메뉴가 많아지면 찾는 시간이 늘 뿐 아니라, 새 기능을
// 어디에 넣어야 할지도 매번 애매해집니다.
//
// 그래서 "무엇에 대한 일인가"를 기준으로 6개로 묶었습니다.
//   업무      - 오늘 할 일 (매일 엶)
//   학교      - 사람과 학사 (학생·교직원·반·과목·학기·학사일정)
//   셔틀      - 등하원 차량
//   기록      - 일어난 일과 그로부터 나온 개선안 (사건·회의·행사 → 제안 → 발행)
//   문서·매뉴얼 - 참고해서 읽는 것
//   관리      - 관리자만 쓰는 설정 (계정·시스템·데이터)
// 여기에 주간 학생 관찰기록(요청대로 손대지 않음)과 개발자 메뉴가 더해집니다.
//
// accent는 이 카테고리가 어느 "앱"에 속하는지 색으로 알려줍니다.
// pendingProposals/pendingAdopted - 제안함(검토대기)·채택예정(발행대기) 건수입니다. 메뉴를 열어
// 보지 않아도 검토할 게 있는지 사이드바에서 바로 빨간 숫자로 보입니다.

// ── 업무 ────────────────────────────────────────────────────────────────────
// 가장 자주 여는 화면이라 맨 위에 둡니다. 예전에는 하위 화면(보고서·지난 업무·휴지통)이 메뉴에
// 없어서 업무 보드 안에서만 오갈 수 있었는데, 부메뉴로 꺼내 바로 갈 수 있게 했습니다.
// 업무는 "이 메뉴만 띄워두고도 모든 상황을 확인·처리하는 관제탑"입니다(요청). 그래서 개요
// 대시보드를 맨 앞에 두고, 예전 [기록] 대분류(사건·회의·행사·제안·채택)를 업무 안으로 흡수해
// 7→5 대분류로 줄였습니다. 각 업무 화면 상단에는 WorkTabs(개요·보드·보고서·기록·제안·보관)가
// 고정으로 붙습니다.
function buildWorkCategory(pendingProposals: number, pendingAdopted: number): NavCategory {
  return {
    key: "work",
    label: "업무",
    icon: "🗂️",
    accent: "blue",
    href: "/work",
    items: [
      // 개요 대시보드는 뺐습니다(요청: 업무 보드 자체가 관제탑이라 개요가 필요 없음).
      // 서브메뉴 = 상단탭(WorkTabs)과 항상 같은 항목·같은 순서입니다(요청: "상단탭이랑
      // 서브메뉴랑 일치해야해"). 사건·회의·행사 기록과 제안·채택은 [문서·매뉴얼]로
      // 되돌렸습니다(요청: 이미 문서·매뉴얼로 이전한 것들).
      { href: "/work", label: "업무 보드", icon: "🗂️" },
      { href: "/work/report", label: "보고서", icon: "📈" },
      { href: "/work/history", label: "지난 업무", icon: "🗃️" },
      { href: "/work/trash", label: "휴지통", icon: "🗑️" },
    ],
  };
}

// ── 학교 ────────────────────────────────────────────────────────────────────
// 학생·교직원·반·과목·학기·학사일정을 한곳에 모았습니다. 예전에는 "학교 관리"와 "학사일정"이
// 따로 있었는데, 둘 다 "학교라는 조직을 굴리는 기준정보"라 나눌 이유가 없었습니다.
// 급식 당번·시설 예약처럼 앞으로 추가될 학사 운영 항목도 이 아래 [학사] 구분선에 붙입니다.
function buildSchoolCategory(isAdmin: boolean, isStaffOrAbove: boolean): NavCategory {
  // 요청("학교메뉴도 길게 복잡해 - 통합·최적화해서 줄여줘")에 따라 9개를 5개로 합쳤습니다.
  // 이 5개는 상단탭(SectionTabs의 SCHOOL_TABS)과 항목·순서가 정확히 같습니다(요청: "결과적으로
  // 상단탭이랑 서브메뉴랑 일치해야해").
  //
  // 합치면서 없어진 화면은 하나도 없습니다. 성격이 같은 것끼리 묶고, 묶인 화면들은 그 탭이
  // 열렸을 때 상단탭 바로 아래 작은 줄로 펼쳐집니다:
  //   학생      = 학생 조회 · 명부 관리 · 명부 점검
  //   반·시간표 = 반 관리 · 과목 · 수업 시간표
  //   학사운영  = 학사일정 · 당번표 · 학기 준비 · 학기 관리
  // 사이드바에 11줄을 늘어놓는 대신, 대분류 5줄만 두고 세부는 화면 안에서 고르는 구조입니다.
  const items: NavLeaf[] = [];
  if (isStaffOrAbove) {
    items.push(
      { href: "/school/overview", label: "개요", icon: "📊" },
      { href: "/students", label: "학생", icon: "🎓" },
      // 학생 통합기록과 같은 구조로 교직원도 입사일/퇴사일/연도별 담당 이력을 한 화면에서
      // 볼 수 있습니다(요청: "교직원에 대한 정보도... 통합으로 관리되게끔").
      { href: "/staff", label: "교직원", icon: "🧑‍💼" }
    );
  }
  if (isAdmin) {
    items.push({ href: "/weekly-report/admin/classes", label: "반 · 시간표", labelEn: "Classes", icon: "🏫" });
  }
  // 학사일정·당번표·학기 준비·학기 관리를 하나로 묶은 대분류입니다.
  items.push({ href: "/academic-calendar", label: "학사운영", icon: "📅" });
  if (isAdmin) {
    // 사무실 대형 모니터 대시보드의 관리 화면입니다(요청: "운영 대시보드는 관리자만").
    // 상단탭에는 없는 유일한 항목이라 [설정] 구분선 아래에 둡니다.
    items.push({ href: "/ops-board", label: "운영 대시보드", icon: "🖥️", dividerBefore: "설정" });
  }
  return { key: "school", label: "학교", icon: "🏛️", accent: "purple", href: "/school/overview", items };
}

// ── 셔틀 ────────────────────────────────────────────────────────────────────
// 등하원 차량은 매일 아침·오후에 실제로 굴러가는 독립된 업무 흐름이라(기준정보 세팅, 당일 운행,
// 대기 안내를 각각 다른 사람이 다른 시간에 씁니다) 그대로 주메뉴로 둡니다. 다만 순서를 "매일
// 쓰는 것 → 가끔 고치는 기준정보"로 바꿨습니다 - 예전에는 기준정보가 먼저 나와서, 하루에 몇 번씩
// 여는 하원 체크표가 목록 아래쪽에 있었습니다.
function buildShuttleCategory(isStaffOrAbove: boolean): NavCategory {
  // 셔틀 하위메뉴를 목적별 3그룹으로 분류합니다(요청: "셔틀쪽 메뉴들 너무 복잡해졌어, 통합할거
  // 통합하고 분류할거 분류"): ① 매일 하원 운영(매일 쓰는 것) ② 기준정보·설정(학기 초에 한 번
  // 세팅하고 가끔 손대는 것) ③ 기록·분석(쌓인 데이터 보기).
  // 셔틀 하위메뉴를 목적별 3그룹으로 분류합니다(요청: "셔틀쪽 메뉴들 너무 복잡해졌어, 통합할거
  // 통합하고 분류할거 분류"): ① 매일 하원 운영(매일 쓰는 것) ② 기준정보·설정(학기 초에 한 번
  // 세팅하고 가끔 손대는 것) ③ 기록·분석(쌓인 데이터 보기).
  // 상단탭(SectionTabs의 SHUTTLE_TABS)과 항목·순서가 정확히 같습니다.
  const items: NavLeaf[] = [
    // 실시간 위치·지역별 현황은 개요 대시보드 상단 지도로 통합했습니다(요청).
    { href: "/shuttle/overview", label: "개요", icon: "📊" },
    { href: "/shuttle/checklist", label: "하원 체크표", icon: "📋" },
    // 요청: "전체 학부모의 채팅을 하나하나 실시간으로 보면서 아이들의 픽업을 처리하는게 너무
    // 힘든데" - 토들·전화·교사·직접입력 어디로 들어온 픽업이든 여기 한 곳에 모입니다.
    { href: "/pickup/inbox", label: "픽업 인박스", icon: "📥" },
  ];
  if (isStaffOrAbove) {
    items.push(
      // 배차표·노선 관리·탑승 배정·지역별·실시간은 이 대분류의 하위 줄로 펼쳐집니다.
      { href: "/shuttle", label: "노선 · 배정", icon: "🛣️" },
      // 내 폰 GPS 테스트는 링크·기기 화면 안(접이식)으로 통합했습니다.
      { href: "/shuttle/pilot", label: "링크 · 기기", icon: "🔗" },
      { href: "/shuttle/stop-times", label: "기록 · 분석", icon: "⏱️" }
    );
  }
  // 카테고리를 직접 누르면 지역별 현황이 열립니다(요청: "셔틀메뉴를 눌렀을 때, 지역셔틀현황이
  // 그냥 먼저 나오도록 해주고 부메뉴에서는 없애줘").
  return { key: "shuttle", label: "셔틀", icon: "🚌", accent: "blue", href: "/shuttle/overview", items };
}

// ── 문서·매뉴얼 ─────────────────────────────────────────────────────────────
// 예전에는 "실무자 매뉴얼"이 최상위 메뉴로 따로 있고, 같은 성격의 "학교 문서함"이 또 다른
// 최상위 메뉴로 있었습니다. 둘 다 "필요할 때 찾아 읽는 것"이라 하나로 합쳤습니다.
// 전화 응대 중 가장 급하게 여는 실무자 매뉴얼을 맨 위에 두고, 카테고리를 직접 눌러도 그 화면이
// 바로 열리게 했습니다 - 합치면서 손이 더 가면 안 되기 때문입니다.
function buildDocumentsCategory(isAdmin: boolean, pendingProposals: number, pendingAdopted: number): NavCategory {
  // 학교와 같은 방식으로 17줄이던 목록을 7개 대분류로 줄였습니다(요청: "통합, 최적화, 줄여줘").
  // 상단탭(SectionTabs의 DOCS_TABS)과 항목·순서가 정확히 같고, 흡수한 화면(매뉴얼 종류, 서류함,
  // AI 서류 작성, 보고서 모음, 등록사건목록, 회의 보고서, 제안함·채택예정·AI 매뉴얼)은 그 탭이
  // 열렸을 때 상단탭 바로 아래 작은 줄로 펼쳐집니다. 사라진 화면은 없습니다.
  const items: NavLeaf[] = [
    { href: "/staff-manual", label: "실무자 매뉴얼", icon: "📚" },
    { href: "/school/documents", label: "문서함", icon: "🗄️" },
    // 사건·회의·행사 기록과 제안·채택은 "남기고 찾아보는 것"이라 문서·매뉴얼에 둡니다
    // (요청: 이미 문서·매뉴얼로 이전했던 항목들).
    { href: "/records/drive", label: "기록 드라이브", icon: "🗃️" },
    { href: "/ops", label: "사건", icon: "🗂️" },
    { href: "/meetings", label: "회의", icon: "💬" },
    { href: "/events", label: "행사", icon: "🎉" },
    // 검토대기(제안함) + 발행대기(채택예정)를 합쳐 하나의 빨간 숫자로 보여줍니다 - 두 화면이
    // 한 대분류로 합쳐졌으므로 배지도 합칩니다.
    { href: "/proposals", label: "제안 · 채택", icon: "📝", badge: pendingProposals + pendingAdopted },
  ];
  if (isAdmin) {
    // 매뉴얼·운영계획안·서류를 어떤 항목으로 나눌지 정하는 기준표입니다. 문서를 쓰는 사람이
    // 아니라 체계를 정하는 사람이 건드리는 화면이라 맨 아래에 둡니다.
    items.push({ href: "/admin/policy-categories", label: "정책 항목 관리", icon: "🗂️", dividerBefore: "분류 기준" });
  }
  return { key: "docs", label: "문서 · 매뉴얼", icon: "📚", accent: "amber", href: "/staff-manual", items };
}


function buildWeeklyReportCategory(isAdmin: boolean): NavCategory {
  const items: NavLeaf[] = [
    { href: "/weekly-report/students", label: "반별 작성 현황", labelEn: "Class Status", icon: "🎓" },
    { href: "/weekly-report/print", label: "리포트 프린트", labelEn: "Print Reports", icon: "🖨️" },
    // 과목별 관찰기록. 만들어 두고 메뉴에 안 붙여서 주소를 직접 쳐야만 열렸습니다.
    { href: "/weekly-report/subjects", label: "과목별 기록", labelEn: "By Subject", icon: "📚" },
  ];
  if (isAdmin) {
    items.push({ href: "/weekly-report/admin/stats", label: "통계 대시보드", labelEn: "Statistics", icon: "📊", dividerBefore: "관리자용" });
  }
  return { key: "weekly", label: "주간 학생 관찰기록", labelEn: "Weekly Student Reports", icon: "📈", accent: "teal", items };
}

// ── 관리 ────────────────────────────────────────────────────────────────────
// 관리자만 쓰는 설정을 모았습니다. 예전에는 계정 관리가 "학교 관리" 안에, 정책 분류와 GIA시스템이
// "학교 문서함" 안에 흩어져 있어서 "설정을 바꾸려면 어디로 가야 하지?"가 매번 헷갈렸습니다.
// 매일 쓰는 화면이 아니라 가끔 손보는 것들이므로 목록 맨 아래에 둡니다.
// 문의및건의사항은 모든 직원이 쓰는 기능이라 여기가 아니라 사이드바 맨 아래 작은 링크로 둡니다.
function buildAdminCategory(): NavCategory {
  return {
    key: "admin",
    label: "관리",
    icon: "⚙️",
    accent: "amber",
    href: "/admin/dashboard",
    items: [
      { href: "/admin/dashboard", label: "통합 대시보드", icon: "📊" },
      // 다른 국제학교/공립학교와 비교해 GIA가 어떤 시스템을 갖췄고 뭘 더 갖춰야 하는지 보는 화면.
      { href: "/admin/gia-systems", label: "GIA시스템", icon: "🧩" },
      { href: "/admin/education-news", label: "교육뉴스", icon: "📰" },
      { href: "/admin/users", label: "사용자 관리", icon: "🔐", dividerBefore: "계정" },
      // 도서관 노트북·신입교사 오리엔테이션용 공용 계정(아이디+비밀번호 로그인) 관리 화면입니다
      // (요청: "도서관이랑, 오리엔테이션용 가계정을 만들어서 관리하게 해줘").
      { href: "/admin/shared-accounts", label: "공용 계정 관리", icon: "🔑" },
      // 크론·수집기·GPS가 실제로 돌고 있는지 한 화면에서 봅니다.
      //
      // 27호 GPS 추적이 3일간 조용히 죽어 있었는데(크론 주소를 옮긴 뒤 스케줄러에 새 주소를
      // 등록하지 않음) 아무도 몰랐던 일이 계기입니다. 이런 실패는 화면이 깨지지 않고 그냥
      // 새 데이터가 안 들어올 뿐이라, 조용한 날과 고장난 날이 똑같이 보입니다.
      { href: "/admin/integrations", label: "연동 상태", icon: "🔌", dividerBefore: "점검" },
      { href: "/school/import", label: "구글시트 가져오기", icon: "📥", dividerBefore: "데이터" },
      { href: "/admin/backups", label: "데이터 백업", icon: "💾" },
      // 새 기능을 올린 뒤 마이그레이션이 제대로 걸렸는지 한 번에 확인하는 화면입니다
      // (요청: "제대로 반영되는지 안되는지 편하게 확인할 수 있는 방법이 없을까?").
      { href: "/admin/schema", label: "데이터베이스 점검", icon: "🗄️" },
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

  // 화면 언어(요청: "교사권한이 볼 수 있는 페이지는 영/한 완전히 변환할 수 있게"). 쿠키에서
  // 읽어 서버가 렌더링할 때부터 적용하므로, 영어로 켜둔 원어민 교사에게는 첫 화면부터 영어로
  // 뜹니다(한글로 그렸다가 영어로 바뀌는 깜빡임이 없습니다).
  const lang = await getLang();
  const t = makeT(lang);
  const isDemoAccountUser = isDemoAccount(me.email);

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
  const badgeLabel = positionLabel(isDeveloper && !isPreviewing ? "개발자" : me.position, lang);

  // 담임(또는 부담임)으로 배정된 반이 있는지 - "내 반 픽업 체크" 메뉴를 담임에게만 보여주기
  // 위해서입니다(요청: "담임교사는 자기 반만 보이고, 과목교사선생님은 보이지 않도록").
  // 교사가 아닌 경우에는 조회 자체를 건너뜁니다(메뉴가 교사 목록에만 있으므로).
  let isHomeroomTeacher = false;
  if (isTeacher) {
    const { count } = await supabase
      .from("wr_classes")
      .select("id", { count: "exact", head: true })
      .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`);
    isHomeroomTeacher = (count ?? 0) > 0;
  }

  // 교사는 로그인하면 "우리 반 현황"(자기반 문의·픽업 대시보드)이 첫 화면입니다(요청: "교사
  // 권한으로 로그인했을때 (...) 제일 첫화면으로 나오는 대시보드"). 담임 배정이 없는 과목 교사는
  // 볼 문의가 없으므로 기존처럼 위클리 리포트를 첫 화면으로 둡니다.
  const homeHref = isTeacher ? "/my-class" : "/home";

  // 교사는 GIA ops/업무 등 다른 메뉴를 아예 볼 수 없고 위클리 리포트만 보입니다(계약직으로
  // 짧게 근무할 수도 있어 내부 문서 성격의 다른 메뉴를 감춥니다 - middleware.ts에서 실제
  // 접근 자체도 막습니다). 관리자/행정직원/개발자는 기존 메뉴 전체 + 위클리 리포트를 함께 봅니다.
  let categories: NavCategory[];
  if (isTeacher) {
    categories = [
      // 교사 로그인 첫 화면 = "우리 반 개요"(담임) / "내 시간표"(과목). 상단탭 고정으로 다른
      // 교사 화면(주간 리포트·픽업·행정실 문의)으로 이동합니다(요청 3).
      { key: "myclass", label: isHomeroomTeacher ? "우리 반 개요" : "내 시간표", labelEn: isHomeroomTeacher ? "My Class" : "My Schedule", icon: "🏫", href: "/my-class", accent: "teal" },
      // 주간 리포트는 담임 선생님만 작성합니다(요청 3: 내 과목 없애기).
      ...(isHomeroomTeacher
        ? [{ key: "homeroom", label: "주간 리포트", labelEn: "Weekly Report", icon: "📝", href: "/weekly-report/homeroom", accent: "teal" } as NavCategory]
        : []),
      // 실시간 셔틀은 교사 메뉴에서 뺐습니다(요청: "교사화면에서 실시간 셔틀은 안보여도 되고").
      // 대신 담임 선생님이 학부모께 직접 연락받은 픽업을 체크하는 화면을 둡니다. 담임 배정이
      // 없는 과목 교사에게는 이 항목 자체가 뜨지 않습니다.
      ...(isHomeroomTeacher
        ? [{ key: "pickup", label: "우리 반 픽업", labelEn: "Pickup Check", icon: "🚗", href: "/pickup", accent: "teal" } as NavCategory]
        : []),
      // 담임/과목 선생님 → 행정실 문의·도움요청 창구(요청 4).
      { key: "office", label: "행정실 문의", labelEn: "Office Request", icon: "💬", href: "/my-class/office", accent: "teal" },
      // 학사일정은 교사에게는 감춥니다(요청: "교사권한은 학사일정 안보이게"). 예전에는 이 자리에
      // "행정요청" 메뉴가 있었지만 제거되었습니다(요청: "행정요청도 없애줘, 구글챗 미러링이
      // 된다면 행정요청도 여기로 받을거라서 상관없어") - 교사는 계속 구글챗으로 행정직원에게
      // 요청하고, 관리자/행정직원은 업무탭에서 그 내용을 실시간으로 확인합니다.
      // 출석부 메뉴는 요청("일단 지금 출석부를 쓸건 아니니까 출석부메뉴는 감춰줘")에 따라
      // 당분간 사이드바에서 숨겨둡니다. /attendance 화면 자체와 기능은 그대로 남아있어서,
      // 나중에 이 항목의 주석만 풀면 바로 다시 노출할 수 있습니다.
      // { key: "attendance", label: "출석부", labelEn: "Attendance", icon: "🗒️", href: "/attendance", accent: "teal" },
    ];
  } else {
    categories = [
      // "홈" 메뉴는 없앴습니다 - 왼쪽 로고(사이드바)/상단 로고(모바일)를 누르면 항상 홈으로
      // 이동하므로(아래 homeHref), 메뉴에 따로 자리를 차지할 필요가 없습니다.
      //
      // 순서는 "얼마나 자주 여는가"입니다. 업무와 셔틀은 매일 여러 번, 학교·기록은 필요할 때,
      // 문서는 찾아볼 때, 관리는 가끔입니다.
      buildWorkCategory(pendingProposals, pendingAdopted),
      buildSchoolCategory(isAdmin, isStaffOrAbove),
      ...(isStaffOrAbove ? [buildShuttleCategory(isStaffOrAbove)] : []),
      buildDocumentsCategory(isAdmin, pendingProposals, pendingAdopted),
      // 출석부 메뉴는 요청("일단 지금 출석부를 쓸건 아니니까 출석부메뉴는 감춰줘")에 따라
      // 당분간 숨겨둡니다. /attendance 화면 자체와 기능은 그대로 남아있어서, 나중에 이 항목의
      // 주석만 풀면 [학교] 아래에 바로 다시 노출할 수 있습니다.
      // { href: "/attendance", label: "출석부", labelEn: "Attendance", icon: "🗒️" },
    ];
    if (isStaffOrAbove) categories.push(buildWeeklyReportCategory(isAdmin));
    if (isAdmin) categories.push(buildAdminCategory());
    // 💰 재무. **직위가 아니라 열쇠로** 나옵니다 - 관리자여도 열쇠가 없으면 이 메뉴는
    // 존재하지 않습니다(담당자: "재무관리자만 이 돈에 관한 메뉴를 볼 수 있도록").
    if (hasFinanceAccess(me)) {
      categories.push({
        key: "finance",
        label: "재무",
        icon: "💰",
        accent: "teal",
        href: "/finance",
        items: [
          { href: "/finance", label: "개요", icon: "📊" },
          { href: "/finance/invoices", label: "인보이스 명단", icon: "🧾" },
          { href: "/finance/items", label: "학비외 항목", icon: "📚" },
          { href: "/finance/plans", label: "납부 항목 · 할인", icon: "💵" },
        ],
      });
    }
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
    <LanguageProvider initialLang={lang}>
    <ToastProvider>
    <ConfirmProvider>
    <NotificationProvider userEmail={isTeacher ? null : me.email}>
    <div data-theme={theme} className="shell-page-bg relative flex h-screen flex-1">
      <ConnectionBanner />
      <CommandPalette categories={categories} homeHref={homeHref} />
      {/* 인쇄할 때는 사이드바를 감춥니다 - 체크표 인쇄본이 종이 폭을 온전히 쓰도록. */}
      <aside className="shell-blur hidden w-56 shrink-0 border-r border-[var(--shell-border)] bg-[var(--shell-bg)] p-4 sm:flex sm:flex-col print:!hidden">
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
            같은 테두리 안에 둬서 메뉴 영역을 더 넓게 확보했습니다(요청: "이 위젯 좀더 작게").

            교사에게는 검색창을 감춥니다(요청: "교사계정은 달력위에 검색창 없애주고"). 이 검색은
            사건기록·회의·업무·학교문서를 훑는 통합 검색인데, 교사는 그 화면들에 애초에 들어갈 수
            없어서 무엇을 쳐도 결과가 나오지 않습니다. 달력만 남깁니다. */}
        <div className="mb-2 shrink-0 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-card-bg)] p-1.5">
          {!isTeacher && (
            <div className="mb-1.5 border-b border-[var(--shell-border)] pb-1.5">
              <GlobalSearchBar compact />
            </div>
          )}
          <DateTimeCard compact />
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-visible">
          <SidebarNavLinks categories={categories} />
        </nav>
        {/* 문의및건의사항은 특정 부서/직급 전용 기능이 아니라 버그 제보·건의 창구라, 관리자
            메뉴에 묶지 않고 누구나 눈에 띄게 맨 아래에 작은 링크로 둡니다. 교사에게도 엽니다
            (요청: "문의할 수 있는 창구도 한글/영어 병기할 수 있게 해줘") - 원어민 선생님도
            읽을 수 있도록 영어를 함께 적습니다. */}
        <Link
          href="/inquiries"
          className="mb-1 flex px-3 py-1.5 text-xs text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]"
        >
          🗣️ {t("문의및건의사항", "Questions & Suggestions")}
        </Link>
        {/* 한국어 ↔ English 전환(요청: "교사권한이 볼 수 있는 페이지는 영/한 완전히 변환할 수
            있게"). 원어민 교사가 스스로 바꿀 수 있어야 해서 관리자 설정이 아니라 항상 손닿는
            사이드바 하단에 둡니다. 선택은 쿠키에 1년간 저장되어 다음 로그인에도 유지됩니다. */}
        <div className="mb-2 px-3">
          <LanguageToggle />
        </div>
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
        <header className="shell-blur flex items-center justify-between border-b border-[var(--shell-border)] bg-[var(--shell-bg)] px-4 py-3 sm:hidden print:!hidden">
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
        {/* 모바일에서도 같은 이유로 교사에게는 검색줄을 감춥니다 - 화면이 좁을수록 쓸 수 없는
            입력칸이 차지하는 자리가 아깝습니다. */}
        {!isTeacher && (
          <div className="shell-blur border-b border-[var(--shell-border)] bg-[var(--shell-bg)] px-3 py-2 sm:hidden">
            <GlobalSearchBar compact />
          </div>
        )}
        <nav className="shell-blur flex items-center gap-1 overflow-x-auto border-b border-[var(--shell-border)] bg-[var(--shell-bg)] px-2 py-2 sm:hidden">
          <MobileNavLinks categories={categories} />
          <Link href="/inquiries" className="ml-auto shrink-0 rounded-lg px-2 py-1.5 text-xs text-[var(--shell-text-muted)]">
            🗣️ {t("문의", "Ask")}
          </Link>
          <LanguageToggle className="shrink-0" />
        </nav>
        {/* 오리엔테이션(교육용) 계정 표시. 이 계정에 보이는 학생은 전부 가짜라, 설명을 듣는
            신입 선생님이 "지금 실제 학생 기록을 건드리고 있나?" 하고 헷갈리지 않도록 화면 위에
            항상 띄워둡니다. 스크롤해도 사라지지 않게 본문 영역 바깥에 둡니다. */}
        {isDemoAccountUser && (
          <div className="shrink-0 bg-amber-400 px-4 py-1.5 text-center text-xs font-bold text-amber-950">
            {t(
              "연습용 계정입니다. 여기 보이는 학생은 모두 가짜이며, 무엇을 저장해도 실제 기록에는 반영되지 않습니다.",
              "Training account. Every student shown here is fictional — nothing you save affects real records."
            )}
          </div>
        )}
        {/* 대분류 상단 탭바(요청 ④: "어떤 페이지를 보건 상단탭 자리는 고정해줘"). 예전에는 각
            페이지가 본문 안에서 직접 탭바를 그려서, 페이지마다 다른 바깥 상자(max-w·padding)
            때문에 탭의 시작점과 폭이 화면을 옮길 때마다 달라졌습니다. 본문 위 한 자리에서 한 번만
            그리면 어떤 화면에서든 같은 자리·같은 크기입니다. */}
        <SectionTabs isTeacher={isTeacher} isHomeroom={isHomeroomTeacher} />
        <MainArea>{children}</MainArea>
      </div>
    </div>
    </NotificationProvider>
    </ConfirmProvider>
    </ToastProvider>
    </LanguageProvider>
  );
}
