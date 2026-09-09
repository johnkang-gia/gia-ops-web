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
const ACCENT: Record<AccentKey, { title: string; on: string; subOn: string }> = {
  blue: { title: "text-blue-700", on: "border-blue-600 text-blue-700", subOn: "bg-blue-50 text-blue-700" },
  purple: { title: "text-purple-700", on: "border-purple-600 text-purple-700", subOn: "bg-purple-50 text-purple-700" },
  navy: { title: "text-gia-navy", on: "border-gia-navy text-gia-navy", subOn: "bg-slate-100 text-gia-navy" },
  amber: { title: "text-amber-700", on: "border-amber-600 text-amber-700", subOn: "bg-amber-50 text-amber-700" },
  teal: { title: "text-teal-700", on: "border-teal-600 text-teal-700", subOn: "bg-teal-50 text-teal-700" },
  red: { title: "text-red-700", on: "border-red-600 text-red-700", subOn: "bg-red-50 text-red-700" },
  emerald: { title: "text-emerald-700", on: "border-emerald-600 text-emerald-700", subOn: "bg-emerald-50 text-emerald-700" },
};

// 상단 탭줄의 **고정 높이**. 픽셀을 박아 두는 이유가 있습니다.
//
// 예전에는 하위 줄(children)이 있는 탭에서만 그 줄이 생겨서, 탭을 옮길 때마다 본문이
// 28px 씩 위아래로 튀었습니다. 탭 개수가 많은 대분류는 좁은 화면에서 두 줄로 접히면서
// 또 한 번 튀었습니다. 화면마다 시작점이 다르면 사람은 매번 눈으로 다시 찾아야 합니다.
//
// 그래서 하위 줄은 **있든 없든 자리를 늘 차지하고**, 탭줄은 접히지 않고 옆으로 흐릅니다.
const SUB_ROW_H = "h-[30px]";

// ── 개발자 ──────────────────────────────────────────────────────────────────
//
// 담당자: "개발자 메뉴도 개요 메뉴와 상단 탭 형식으로 바꾸고."
//
// 지금까지 개발자 화면은 **한 장에 여섯 덩이**가 세로로 쌓여 있었습니다. 오류 로그는 맨
// 아래라, 정작 오류가 났을 때 한참 스크롤해야 보였습니다. 급할 때 찾는 것을 맨 아래 두면
// 안 됩니다. 다른 대분류와 같은 모양으로 갈랐습니다.
const DEV_TABS: TabDef[] = [
  { key: "overview", label: "개요", icon: "📊", href: "/dev", match: ["/dev"] },
  { key: "diagnostics", label: "진단", icon: "🔎", href: "/dev/diagnostics", match: ["/dev/diagnostics"] },
  { key: "errors", label: "오류", icon: "🚨", href: "/dev/errors", match: ["/dev/errors"] },
  { key: "ai", label: "AI 과금", icon: "🤖", href: "/dev/ai", match: ["/dev/ai"] },
  {
    key: "data",
    label: "데이터",
    icon: "💾",
    href: "/admin/backups",
    match: ["/admin/backups", "/admin/schema-check"],
    children: [
      { label: "백업 · 복원", href: "/admin/backups" },
      { label: "스키마 점검", href: "/admin/schema-check" },
    ],
  },
  { key: "changelog", label: "변경 기록", icon: "📜", href: "/changelog", match: ["/changelog"] },
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
      { label: "출석부", href: "/attendance", match: ["/attendance"] },
      { label: "출석현황", href: "/attendance/status", match: ["/attendance/status"] },
      { label: "수업일 달력", href: "/attendance/calendar", match: ["/attendance/calendar"] },
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
      { label: "반/담임", href: "/weekly-report/admin/classes" },
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
  { key: "overview", label: "개요", icon: "📊", href: "/finance", match: ["/finance"] },
  // 청구 — 학비와 학비외를 **한 자리에** 둡니다.
  //
  // 둘은 대분류로 나란히 서 있었습니다. 그런데 하는 일은 하나입니다 - 이번 달에 이 아이에게
  // 얼마를 청구하는가. 대분류가 둘이면 「학비 넣고, 다시 위로 올라가서, 학비외 넣고」가 되고,
  // 그 사이에 한쪽을 빠뜨립니다.
  //
  // 표는 여전히 둘입니다. 학비는 학부모가 서명해서 고른 **납부 옵션**이고, 학비외는 «이 아이가
  // 이 책을 산다»는 **체크**라 근거가 다릅니다. 한 표에 섞으면 둘 다 안 됩니다.
  //
  // 하위 이름은 DB 의 `invoices.stream` 값(학비·학비외)과 **같은 말**을 씁니다. 화면에서 부르는
  // 이름과 저장된 값이 다르면, 집계가 안 맞을 때 어느 쪽 이야기인지부터 헷갈립니다.
  {
    key: "billing",
    label: "청구",
    icon: "🧾",
    href: "/finance/tuition",
    match: ["/finance/tuition", "/finance/invoices"],
    children: [
      { label: "학비", href: "/finance/tuition", match: ["/finance/tuition"] },
      { label: "학비외", href: "/finance/invoices", match: ["/finance/invoices"] },
    ],
  },
  // 현금영수증은 수납 안으로 들여놨습니다. 수납을 넣는 자리에서 신청이 생기고 그 결과를
  // 보는 자리가 현금영수증이라, 둘은 한 가지 일의 앞뒤입니다.
  {
    key: "payments",
    label: "수납",
    icon: "💳",
    href: "/finance/payments",
    match: ["/finance/payments", "/finance/receipts"],
    children: [
      { label: "수납", href: "/finance/payments", match: ["/finance/payments"] },
      { label: "현금영수증", href: "/finance/receipts", match: ["/finance/receipts"] },
    ],
  },
  // 「무엇을 얼마에 걷는가」를 정하는 두 화면입니다. 청구하는 화면과 달리 자주 열지 않고,
  // 학기 초에 한 번 정해두는 자리라 함께 둡니다.
  {
    key: "catalog",
    label: "항목 · 할인",
    icon: "📚",
    href: "/finance/plans",
    match: ["/finance/plans", "/finance/items"],
    children: [
      { label: "납부 항목 · 할인", href: "/finance/plans", match: ["/finance/plans"] },
      { label: "학비외 항목", href: "/finance/items", match: ["/finance/items"] },
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
    <div className="shrink-0 px-4 pt-3 sm:px-6 print:!hidden">
      {/* 탭이 앉는 "선반"을 만듭니다.
          담당자: "메뉴바 (...) 구분이 없어져서 가시성이 너무 떨어져."
          유리 배경 위에 글자만 떠 있으면 탭인지 문장인지 구분이 안 됩니다. 아래에 실선을
          한 줄 깔아 두면, 켜진 탭이 그 선 위에 올라앉은 모양이 되어 한눈에 읽힙니다. */}
      <div className="flex items-center gap-x-1 overflow-x-auto border-b-2 border-[var(--shell-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      <div className={"flex items-center gap-1 overflow-x-auto pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " + SUB_ROW_H}>
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
                  "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition-colors " +
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
