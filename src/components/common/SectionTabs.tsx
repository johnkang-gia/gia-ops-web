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

type AccentKey = "blue" | "purple" | "navy" | "amber" | "teal" | "red" | "emerald";

// Tailwind는 문자열을 이어붙여 만든 클래스명을 빌드 시점에 알아보지 못하므로(그러면 그 색이
// 통째로 빠집니다) 조합을 하드코딩해 둡니다.
// ── 고른 하위 탭이 배경과 구분되어야 합니다 ────────────────────────────────
//
// 예전에는 `bg-*-50` 이었습니다. 탭줄 자체가 연한 회색 배경 위에 있어서, 50 단계는
// **골라 놓아도 안 골라진 것과 거의 같아 보였습니다** - 재무의 학비/학비외가 특히 그랬습니다.
// 어느 쪽을 보고 있는지 모르면 사람은 매번 두 탭을 번갈아 눌러 확인하게 됩니다.
//
// 100 단계 배경 + 800 단계 글자 + 같은 색 테두리로 올렸습니다. 「고름」은 눈으로 한 번에
// 읽혀야 하고, 그건 취향이 아니라 화면이 해야 할 일입니다.
/**
 * **켜진 하위탭은 진한 바탕에 흰 글자입니다.**
 *
 * 예전에는 연한 바탕(`bg-*-100`)에 같은 계열 글자였습니다. 재무 > 청구의 학비·학비외·미납금이
 * 셋 다 옅은 초록이라, **지금 어느 화면에 있는지가 한눈에 안 들어왔습니다.** 세 화면의
 * 생김새가 비슷해서(학생 × 항목 표) 탭 색이 유일한 표시인데, 그 표시가 배경과 거의 같은
 * 밝기였습니다.
 *
 * 켜진 것과 안 켜진 것은 **밝기로** 갈라야 합니다. 같은 색의 진하기 차이는 화면 밝기·각도에
 * 따라 사라지지만, 진한 바탕 위의 흰 글자는 어디서 봐도 보입니다.
 */
const ACCENT: Record<AccentKey, { title: string; on: string; subOn: string }> = {
  blue: { title: "text-blue-700", on: "border-blue-600 text-blue-700", subOn: "bg-blue-600 text-white shadow-sm" },
  purple: { title: "text-purple-700", on: "border-purple-600 text-purple-700", subOn: "bg-purple-600 text-white shadow-sm" },
  navy: { title: "text-gia-navy", on: "border-gia-navy text-gia-navy", subOn: "bg-gia-navy text-white shadow-sm" },
  amber: { title: "text-amber-700", on: "border-amber-600 text-amber-700", subOn: "bg-amber-600 text-white shadow-sm" },
  teal: { title: "text-teal-700", on: "border-teal-600 text-teal-700", subOn: "bg-teal-600 text-white shadow-sm" },
  red: { title: "text-red-700", on: "border-red-600 text-red-700", subOn: "bg-red-600 text-white shadow-sm" },
  emerald: { title: "text-emerald-700", on: "border-emerald-600 text-emerald-700", subOn: "bg-emerald-700 text-white shadow-sm" },
};

// 상단 탭줄의 **고정 높이**. 픽셀을 박아 두는 이유가 있습니다.
//
// 예전에는 하위 줄(children)이 있는 탭에서만 그 줄이 생겨서, 탭을 옮길 때마다 본문이
// 28px 씩 위아래로 튀었습니다. 탭 개수가 많은 대분류는 좁은 화면에서 두 줄로 접히면서
// 또 한 번 튀었습니다. 화면마다 시작점이 다르면 사람은 매번 눈으로 다시 찾아야 합니다.
//
// 그래서 하위 줄은 **있든 없든 자리를 늘 차지하고**, 탭줄은 접히지 않고 옆으로 흐릅니다.
//
// **높이는 알약보다 넉넉해야 합니다.** 30px 였을 때 알약(24px)이 위 여백 6px 아래에 정확히
// 30px 자리에서 끝났습니다. 그런데 이 줄은 `overflow-x-auto` 라 세로도 함께 잘리는 상자가
// 되고(한 축이 auto 면 다른 축의 visible 은 auto 로 계산됩니다), 그래서 켜진 알약의 **아래
// 테두리가 한 줄 깎여** 바닥에 잘린 것처럼 보였습니다.
//
// 4px 을 더해 위아래로 2px 씩 숨통을 둡니다. 자리를 늘 차지한다는 성질은 그대로입니다.
const SUB_ROW_H = "h-[34px]";

// ── 개발자 ──────────────────────────────────────────────────────────────────
//
// 담당자: "개발자 메뉴도 개요 메뉴와 상단 탭 형식으로 바꾸고."
//
// 지금까지 개발자 화면은 **한 장에 여섯 덩이**가 세로로 쌓여 있었습니다. 오류 로그는 맨
// 아래라, 정작 오류가 났을 때 한참 스크롤해야 보였습니다. 급할 때 찾는 것을 맨 아래 두면
// 안 됩니다. 다른 대분류와 같은 모양으로 갈랐습니다.
const DEV_TABS: TabDef[] = [
  /**
   * **개발자 메뉴는 세 갈래.** 「지금 어떤가」(현황·오류) · 「잘못된 데가 있나」(점검) · 「무엇을
   * 얼마나 썼고 무엇을 남겼나」(사용량·백업·변경 기록). 탭이 여덟일 때는 무엇이 고장 났을 때
   * 어디부터 열어야 하는지가 매번 질문이었습니다. 화면은 그대로 두고 탭 아래 작은 줄로 엽니다.
   */
  {
    key: "overview",
    label: "현황",
    icon: "📊",
    href: "/dev",
    match: ["/dev", "/dev/errors"],
    children: [
      { label: "개요 · 사이트 점검", href: "/dev", match: ["/dev"] },
      { label: "오류", href: "/dev/errors" },
    ],
  },
  {
    key: "health",
    label: "점검",
    icon: "🔎",
    href: "/dev/diagnostics",
    match: ["/dev/diagnostics", "/dev/inspect", "/admin/schema"],
    children: [
      { label: "시스템 진단", href: "/dev/diagnostics" },
      { label: "보호 · 코드 점검", href: "/dev/inspect" },
      { label: "DB 스키마", href: "/admin/schema" },
    ],
  },
  // 예전 「데이터」 탭의 「스키마 점검」은 없는 주소(/admin/schema-check)를 가리켰습니다.
  {
    key: "records",
    label: "사용량 · 기록",
    icon: "💾",
    href: "/dev/ai",
    match: ["/dev/ai", "/dev/usage", "/admin/backups", "/changelog"],
    children: [
      { label: "AI 과금", href: "/dev/ai" },
      { label: "화면 이용 기록", href: "/dev/usage" },
      { label: "백업 · 복원", href: "/admin/backups" },
      { label: "변경 기록", href: "/changelog" },
    ],
  },
];

// ── 업무 ────────────────────────────────────────────────────────────────────
const WORK_TABS: TabDef[] = [
  { key: "board", label: "업무 보드", icon: "🗂️", href: "/work", match: ["/work"] },
  // 「연락 · 출결」 탭을 뺐습니다.
  //
  //   · 연락 검색 — 업무 보드에서 이미 찾을 수 있습니다. 같은 일을 두 자리에 두면 어느
  //     쪽이 최신인지 묻게 되고, 결국 둘 다 안 봅니다.
  //   · 학부모 문의 — [문의사항]은 이 앱을 쓰는 **직원**의 문의를 받는 창구입니다.
  //     학부모 연락과 이름이 겹쳐 여기 걸려 있었는데, 다른 일이라 업무 탭에 있을 자리가
  //     아닙니다.
  //
  // 화면(/work/inquiry-search, /inquiries)은 지우지 않았습니다 - 주소로 들어가면 그대로
  // 열립니다. 메뉴에서만 내립니다.
  // 하원수단을 여기 둡니다. 학부모 연락이 «임선우·임다현 월·금 2시 40분 학원 셔틀»처럼
  // 여러 아이·여러 요일로 한 번에 오는데, 아이 프로필을 하나씩 열어 넣게 하면 그 번거로움이
  // 곧 «나중에 하자»가 되고, 나중에 한 것은 대개 안 한 것이 됩니다.
  { key: "dismissal", label: "하원수단", icon: "🎒", href: "/work/dismissal", match: ["/work/dismissal"] },
  { key: "report", label: "보고서", icon: "📈", href: "/work/report", match: ["/work/report"] },
  // 끝난 것을 보는 두 자리입니다. 매일 쓰는 탭들과 같은 줄에 나란히 있으면, 정작 오늘 할 일이
  // 뒤로 밀립니다.
  {
    key: "archive",
    label: "보관함",
    icon: "🗃️",
    href: "/work/history",
    match: ["/work/history", "/work/trash"],
    children: [
      { label: "지난 업무", href: "/work/history", match: ["/work/history"] },
      { label: "휴지통", href: "/work/trash", match: ["/work/trash"] },
    ],
  },
];

// ── 학교 ────────────────────────────────────────────────────────────────────
// 요청("학교메뉴도 길게 복잡해 - 통합·최적화해서 줄여줘")에 따라 9개를 5개로 합쳤습니다.
// 합치면서 사라진 화면은 없습니다. 성격이 같은 것끼리 묶고, 묶인 화면들은 그 탭이 활성일 때
// 바로 아래 작은 줄(children)로 펼쳐 한 번에 갈 수 있게 했습니다.
const SCHOOL_TABS: TabDef[] = [
  { key: "overview", label: "개요", icon: "📊", href: "/school/overview", match: ["/school/overview", "/school"] },
  {
    key: "students",
    label: "학생",
    icon: "🎓",
    href: "/students",
    match: [
      "/students",
      "/weekly-report/admin/students",
      "/weekly-report/admin/class-roster",
      "/school/data-check",
      "/school/import",
      "/school/sheet",
      "/school/groups",
      "/school/apparel",
      "/school/toddle",
      "/school/library",
    ],
    children: [
      { label: "학생 조회", href: "/students", match: ["/students"] },
      // 「명부 관리」 하나로 모았습니다. 명부를 보는 일, 구글시트에서 받아오는 일, 겹친 줄을
      // 정리하는 일, 처음 한 번 통째로 넣는 일은 전부 같은 명부를 두고 하는 일인데 여기에
      // 네 줄로 늘어서 있었습니다. 서로 무슨 관계인지 알 수 없고, 「학생」 아래가 여덟 줄이라
      // 정작 자주 쓰는 것이 묻혔습니다. 흡수한 화면들은 그 안에서 갈립니다(ROSTER_TABS).
      {
        label: "명부 관리",
        href: "/weekly-report/admin/students",
        match: ["/weekly-report/admin/students", "/school/sheet", "/school/data-check", "/school/import"],
      },
      // 아이를 반에 넣는 일은 학생 자료를 고치는 일입니다. 반을 만들고 담임을 붙이는
      // 일(반 · 시간표)은 학기와 교사에 붙습니다 - 성격이 달라 탭도 갈랐습니다.
      { label: "반 배정", href: "/weekly-report/admin/class-roster", match: ["/weekly-report/admin/class-roster"] },
      // 반이 아닌 명단(방과후·악기반). 학년·반은 어느 교실에 앉는가이고, 이것은 무엇을 하는가입니다.
      { label: "수강 그룹", href: "/school/groups", match: ["/school/groups"] },
      // 교복·행사 티셔츠. 사이즈는 학생에 저장되어 행사마다 다시 조사하지 않습니다.
      { label: "의류", href: "/school/apparel", match: ["/school/apparel"] },
      // 토들 방 이름 ↔ 학생. 학기에 한 번 하는 일이라 명부 옆에 둡니다 - 학기 초에
      // 명부를 정리할 때 함께 끝내야 잊지 않습니다.
      { label: "토들 채널", href: "/school/toddle", match: ["/school/toddle"] },
      // 도서관은 별도 앱이지만 자료는 같은 DB 입니다. 연체·오늘 방문·학생증 미발급을 여기서 읽고,
      // 대출·반납은 도서관 앱으로 넘어갑니다.
      { label: "도서관", href: "/school/library", match: ["/school/library"] },
    ],
  },
  // 출석부는 학교 자료입니다. 업무 메뉴(연락·출결)에 있던 것을 옮겼습니다 - 거기서는
  // 학부모 연락을 처리하는 도구로 보였는데, 실제로는 학적에 가까운 기록입니다.
  {
    key: "attendance",
    label: "출석부",
    icon: "🗒️",
    href: "/attendance",
    match: ["/attendance"],
    children: [
      { label: "출석부", href: "/attendance", match: ["/attendance", "/attendance/calendar"] },
      { label: "출석현황", href: "/attendance/status", match: ["/attendance/status"] },
      // 「수업일 달력」을 뺐습니다. 수업일은 출석률의 **분모**라 출석부를 보다가 곧바로
      // 확인하게 되는데, 건너가면 보고 있던 날짜·반이 풀립니다. 두 화면 모두 위쪽의
      // 「📆 수업일 달력」 단추가 팝업으로 엽니다.
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
      { label: "반/담임", href: "/weekly-report/admin/classes", match: ["/weekly-report/admin/classes", "/weekly-report/admin/subjects"] },
      // 「과목」을 뺐습니다. 반을 만들고 담임을 붙이는 일과 과목에 담당을 붙이는 일은 학기
      // 초에 한 자리에서 한 번에 끝내야 하는데, 화면이 갈려 있어서 한쪽만 하고 잊는 일이
      // 반복됐습니다. [반/담임] 위의 「📗 과목반 세팅」 단추가 팝업으로 엽니다.
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
  // 학부모 상담 — 행사마다 상담실·명단·기록이 따로 남습니다. 면담 화면(/consult)은 선생님도 씁니다.
  {
    key: "consult",
    label: "학부모 상담",
    icon: "🗣️",
    href: "/school/consult",
    match: ["/school/consult", "/consult"],
    children: [
      { label: "행사 · 안내데스크", href: "/school/consult", match: ["/school/consult"] },
      { label: "면담 화면", href: "/consult", match: ["/consult"] },
    ],
  },
];

// ── 셔틀 ────────────────────────────────────────────────────────────────────
const SHUTTLE_TABS: TabDef[] = [
  { key: "overview", label: "개요", icon: "📊", href: "/shuttle/overview", match: ["/shuttle/overview"] },
  {
    key: "checklist",
    label: "하원 체크표",
    icon: "📋",
    href: "/shuttle/checklist",
    match: ["/shuttle/checklist"],
    children: [
      { label: "하원 체크표", href: "/shuttle/checklist", match: ["/shuttle/checklist"] },
      { label: "하원 셔틀명단", href: "/shuttle/checklist/roster" },
    ],
  },
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
      // 「지역별」을 뺐습니다 - 구/동 지도와 지역별 명단은 [개요]에 그대로 들어가 있습니다.
      // 같은 것을 두 자리에 두면 어느 쪽을 봐야 하는지 묻게 됩니다.
      // 주소(/shuttle/regions)는 살려둡니다 - 즐겨찾기 해둔 사람이 있습니다.
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
  // 「결석·픽업 이력」·「탑승률」·「정류장 시간」을 한 자리로 모았습니다. 셋 다 «지나간 운행을
  // 돌아보는» 일인데 탭 세 자리를 차지해, 매일 쓰는 체크표·인박스가 뒤로 밀려 있었습니다.
  {
    key: "records",
    label: "기록 · 분석",
    icon: "⏱️",
    href: "/shuttle/history",
    match: ["/shuttle/history", "/shuttle/capacity", "/shuttle/stop-times"],
    children: [
      // 지금까지는 **오늘만** 볼 수 있었습니다. "이 아이 이번 달에 몇 번 빠졌지?"를 물으면
      // 아무도 답을 못 했습니다. 기록은 다 쌓여 있는데 꺼내 볼 방법이 없었을 뿐입니다.
      { label: "결석 · 픽업 이력", href: "/shuttle/history", match: ["/shuttle/history"] },
      // 차를 늘릴지 줄일지, 어느 노선을 합칠지는 지금까지 기억과 인상으로 정했습니다.
      // "그 차는 늘 비어 보이던데"는 맞을 때도 있고 아닐 때도 있습니다.
      { label: "탑승률", href: "/shuttle/capacity", match: ["/shuttle/capacity"] },
      { label: "정류장 시간", href: "/shuttle/stop-times", match: ["/shuttle/stop-times"] },
    ],
  },
];

// ── 문서 · 기록 ─────────────────────────────────────────────────────────────
// 학교와 같은 방식으로 17줄이던 사이드바를 7개 대분류로 줄이고, 흡수한 화면은 children으로
// 펼칩니다(요청: "통합, 최적화, 줄여줘" + "상단탭이랑 서브메뉴랑 일치해야해").
const DOCS_TABS: TabDef[] = [
  // 「AI 매뉴얼 작성」을 제안 · 채택에서 여기로 옮겼습니다. 만드는 자리와 읽는 자리가
  // 갈려 있으면, 매뉴얼을 고칠 때마다 어디로 가야 하는지 매번 생각해야 합니다.
  {
    key: "manual",
    label: "매뉴얼",
    icon: "📚",
    href: "/staff-manual",
    match: ["/staff-manual", "/manuals", "/ai-manual"],
    children: [
      { label: "실무자 매뉴얼", href: "/staff-manual", match: ["/staff-manual"] },
      { label: "매뉴얼 (실무자용)", href: "/manuals?doc=실무자용" },
      { label: "운영계획안 (학부모용)", href: "/manuals?doc=학부모용" },
      { label: "AI 매뉴얼 작성", href: "/ai-manual", match: ["/ai-manual"] },
    ],
  },
  // 기록 드라이브를 문서함 안으로 넣었습니다. 둘 다 «파일을 두는 곳»인데 탭이 갈려 있어서,
  // 어느 쪽에 넣었는지 기억해야 찾을 수 있었습니다.
  {
    key: "docs",
    label: "문서함",
    icon: "🗄️",
    href: "/school/documents",
    match: ["/school/documents", "/documents", "/records/drive"],
    children: [
      { label: "문서함 홈", href: "/school/documents", match: ["/school/documents"] },
      { label: "서류함", href: "/documents", match: ["/documents"] },
      { label: "AI 서류 작성", href: "/documents/new" },
      { label: "보고서 모음", href: "/school/documents/reports" },
      { label: "기록 드라이브", href: "/records/drive", match: ["/records/drive"] },
    ],
  },
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
  // 회의와 행사를 한 자리로. 둘 다 «날을 잡아 열고, 끝나면 기록이 남는» 일입니다.
  {
    key: "meetings",
    label: "회의 · 행사",
    icon: "💬",
    href: "/meetings",
    match: ["/meetings", "/events"],
    children: [
      { label: "회의기록", href: "/meetings", match: ["/meetings"] },
      { label: "회의 보고서", href: "/meetings/report" },
      { label: "행사", href: "/events", match: ["/events"] },
    ],
  },
  {
    key: "proposals",
    label: "제안 · 채택",
    icon: "📝",
    href: "/proposals",
    match: ["/proposals", "/adopted"],
    children: [
      { label: "제안함", href: "/proposals" },
      { label: "채택예정", href: "/adopted" },
    ],
  },
];

// ── 재무 ────────────────────────────────────────────────────────────────────
// 재무 화면들은 자기 본문 안에서 따로 탭줄을 그리고 있었습니다. 그래서 재무로 들어오면
// 상단 탭줄이 사라지고 조금 아래에 다른 모양의 줄이 나타났습니다 - 같은 앱인데 화면이
// 바뀐 것처럼 보이는 자리였습니다. 다른 대분류와 같은 줄에 얹습니다.
//
// 순서는 자주 여는 것부터입니다. 재무 일은 대개 "지금 어디까지 됐나"에서 시작합니다.
const FINANCE_TABS: TabDef[] = [
  // **재무는 셋입니다 - 회계 · 월별 · 설정.**
  //
  // 열여섯 화면이 다섯 탭에 흩어져 있었습니다. 「이 아이 미수금이 얼마지」를 보려고 미납금으로,
  // 입금을 적으려고 수납으로, 선납을 적으려고 예치금으로 옮겨 다녔는데 셋 다 회계 화면의 학생
  // 창에서 이미 되는 일입니다. 주소는 전부 남겨 두었습니다(즐겨찾기·옛 링크) - 상단 탭의 자리만
  // 셋으로 줄이고, 일괄로 하는 화면들은 회계 아래 작은 줄에 둡니다.
  {
    key: "ledger",
    label: "회계",
    icon: "📒",
    href: "/finance/ledger",
    match: ["/finance/ledger", "/finance/tuition", "/finance/invoices", "/finance/unpaid", "/finance/payments", "/finance/prepaid", "/finance/import", "/finance/receipts", "/finance/statement", "/finance/approvals"],
    children: [
      // 학생 한 명의 일은 전부 여기 - 학생을 누르면 창 하나에서 발행·이미 받음·입금·영수증·올톡페이.
      { label: "회계", href: "/finance/ledger", match: ["/finance/ledger"] },
      // 반 전체를 한 번에 체크해서 발행하는 표. 하위 이름은 DB 의 `invoices.stream` 값과 같은 말입니다.
      { label: "학비 일괄", href: "/finance/tuition", match: ["/finance/tuition"] },
      { label: "학비외 일괄", href: "/finance/invoices", match: ["/finance/invoices"] },
      { label: "미납금", href: "/finance/unpaid", match: ["/finance/unpaid"] },
      { label: "수납", href: "/finance/payments", match: ["/finance/payments"] },
      { label: "예치금", href: "/finance/prepaid", match: ["/finance/prepaid"] },
      { label: "결제내역 올리기", href: "/finance/import", match: ["/finance/import"] },
      { label: "현금영수증", href: "/finance/receipts", match: ["/finance/receipts"] },
      // 결손·환불은 올린 사람이 아닌 관리자가 승인해야 장부에 들어갑니다.
      { label: "결재", href: "/finance/approvals", match: ["/finance/approvals"] },
    ],
  },
  // **월별** - 「지금」이 아니라 「흐름」. 개요(이번 달)도 같은 뷰(`finance_monthly`)를 읽으므로 여기 둡니다.
  {
    key: "monthly",
    label: "월별",
    icon: "📅",
    href: "/finance",
    match: ["/finance", "/finance/monthly", "/finance/revenue"],
    children: [
      { label: "이번 달 개요", href: "/finance", match: ["/finance"] },
      { label: "월별 · 학기별", href: "/finance/monthly", match: ["/finance/monthly"] },
      { label: "학생별", href: "/finance/monthly/students", match: ["/finance/monthly/students"] },
      // 「무슨 돈으로 얼마」 - 세입과목(관·항·목)별 부과·수납·결손·미수.
      { label: "과목별 수입", href: "/finance/revenue", match: ["/finance/revenue"] },
    ],
  },
  // **설정** - 요금표·납부항목·할인. 청구를 하다가 손대는 일이라 각 표 위의 단추로도 열리지만,
  // 처음 학기를 세팅할 때는 여기서 한 번에 봅니다.
  {
    key: "settings",
    label: "설정",
    icon: "⚙️",
    href: "/finance/plans",
    match: ["/finance/plans", "/finance/items", "/finance/accounts", "/finance/promotion"],
    children: [
      { label: "학비 요금표 · 할인", href: "/finance/plans", match: ["/finance/plans"] },
      { label: "학비외 항목", href: "/finance/items", match: ["/finance/items"] },
      { label: "세입과목", href: "/finance/accounts", match: ["/finance/accounts"] },
      { label: "진급 · 학기 넘기기", href: "/finance/promotion", match: ["/finance/promotion"] },
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
          { key: "consult", label: "학부모 상담", labelEn: "Conferences", icon: "🗣️", href: "/consult", match: ["/consult"] },
        ]
      : [
          { key: "overview", label: "내 시간표", labelEn: "My Schedule", icon: "🗓️", href: "/my-class", match: ["/my-class"] },
          { key: "office", label: "행정실 문의", labelEn: "Office Request", icon: "💬", href: "/my-class/office", match: ["/my-class/office"] },
          { key: "consult", label: "학부모 상담", labelEn: "Conferences", icon: "🗣️", href: "/consult", match: ["/consult"] },
        ];
    const hit = teacherTabs.some((t) => t.match.some((m) => pathname === m || pathname.startsWith(m + "/")));
    return hit ? { title: "교사", titleEn: "Teacher", icon: "👩‍🏫", accent: "teal", tabs: teacherTabs } : null;
  }

  const sections: Section[] = [
    { title: "업무", icon: "🗂️", accent: "blue", tabs: WORK_TABS },
    { title: "개발자", icon: "🧑‍💻", accent: "red", tabs: DEV_TABS },
    { title: "학교", icon: "🏛️", accent: "purple", tabs: SCHOOL_TABS },
    { title: "셔틀", icon: "🚌", accent: "navy", tabs: SHUTTLE_TABS },
    { title: "문서 · 기록", icon: "📚", accent: "amber", tabs: DOCS_TABS },
    { title: "재무", icon: "💰", accent: "emerald", tabs: FINANCE_TABS },
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
    // 아래 여백(pb)이 **주석에만 있고 실제로는 없었습니다.** 그래서 하위 탭 알약의 아래
    // 모서리가 본문이 시작하는 선과 정확히 같은 자리에 놓여, 알약이 바닥에 잘린 것처럼
    // 보였습니다(알약 아래끝 81px = 본문 시작 81px).
    <div className="shrink-0 px-4 pb-1.5 pt-3 sm:px-6 print:!hidden">
      {/* 탭이 앉는 "선반"을 만듭니다.
          담당자: "메뉴바 (...) 구분이 없어져서 가시성이 너무 떨어져."
          유리 배경 위에 글자만 떠 있으면 탭인지 문장인지 구분이 안 됩니다. 아래에 실선을
          한 줄 깔아 두면, 켜진 탭이 그 선 위에 올라앉은 모양이 되어 한눈에 읽힙니다. */}
      <div className="flex items-center gap-x-1 overflow-x-auto px-0.5 border-b-2 border-[var(--shell-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className={"mr-2 shrink-0 whitespace-nowrap text-base font-extrabold " + accent.title}>
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
                "relative -mb-px shrink-0 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors " +
                // 꺼진 탭도 읽혀야 합니다 - slate-500은 유리 바탕에서 흐릿하게 묻힙니다.
                // 마우스를 올렸을 때의 바탕도 반투명 흰색이어야 유리 위에서 보입니다.
                (on
                  ? "border-b-2 " + accent.on
                  : "border-b-2 border-transparent text-slate-600 hover:bg-white/70 hover:text-slate-900")
              }
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.labelEn ? t(tab.label, tab.labelEn) : tab.label}
            </button>
          );
        })}
      </div>

      {/* 대분류를 줄이면서 흡수한 화면들. 탭을 5개로 줄이되 어떤 화면도 사라지지 않게 합니다.
          하위 줄이 없는 탭에서도 **이 자리는 비워 둡니다.** 있을 때만 그리면 탭을 옮길 때마다
          본문 전체가 그 높이만큼 위아래로 튑니다. */}
      {/* 켜진 알약의 링은 상자 **바깥**에 그려지는데 이 줄은 넘친 것을 잘라냅니다. 안쪽에
          2px 을 두지 않으면 맨 앞 알약의 왼쪽 링이 깎여 잘린 것처럼 보입니다. */}
      <div className={"flex items-center gap-1 overflow-x-auto px-0.5 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " + SUB_ROW_H}>
        {subs.length > 0 &&
          subs.map((c) => {
            const on = c.href === activeSub;
            return (
              <button
                key={c.href}
                type="button"
                onClick={() => router.push(c.href)}
                onMouseEnter={() => router.prefetch(c.href)}
                className={
                  "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition-colors " +
                  (on ? "font-bold " : "font-semibold ") +
                  (on ? accent.subOn : "text-slate-500 hover:bg-white/70 hover:text-slate-800")
                }
              >
                {c.labelEn ? t(c.label, c.labelEn) : c.label}
              </button>
            );
          })}
      </div>
    </div>
  );
}
