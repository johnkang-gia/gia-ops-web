"use client";

import { usePathname } from "next/navigation";

// 세 앱(업무/운영/위클리 리포트)이 합쳐져 있다는 걸 항상 인지할 수 있도록, 지금 보고 있는
// 화면이 어느 섹션인지에 따라 배경 톤(과 업무 탭의 경우 완전히 다른 글래스모피즘 테마)을
// 다르게 적용합니다. 업무/위클리 리포트는 원래도 자기만의 고유 룩(workflatform-theme, wr-bg)을
// 쓰고 있어 그대로 유지하고, 나머지 "GIA 운영" 계열 화면들은 shell-content-bg로 테마별 본문
// 배경을 따라가게 했습니다("각 테마에 맞게 페이지 배경 통일" 요청). shell-content-bg는
// 사이드바 배경(shell-page-bg)과 값이 다를 수 있는데, GIA 테마는 사이드바는 짙은 남색을
// 유지하되 글자가 많은 본문은 밝은 톤을 따로 써서 가독성을 확보하기 때문입니다. shell-content
// 클래스는 globals.css에서 다크 테마일 때 이 화면들 안의 text-slate-*/bg-white 같은 라이트
// 전용 클래스를 가독성 있게 다시 칠하는 스코프로 씁니다.
// 목록(게시판형) 화면들 - 스크롤로 계속 늘어지는 대신 화면 높이에 맞춰 고정하고, 목록 안에서는
// Pagination 컴포넌트로 "1 2 3" 페이지를 넘겨보게 했습니다.
//
// **여기 적는 순간 그 화면은 「스스로 굴릴 책임」을 집니다.** 이 목록에 이름이 오르면 <main>이
// overflow-hidden 이 되므로, 화면 안쪽에 스크롤 칸이 없으면 **접힌 부분에 아예 손이 닿지
// 않습니다** - 스크롤 막대조차 안 생겨서, 보는 사람은 그 아래에 내용이 더 있다는 것도 모릅니다.
// 반/담임 화면이 그랬습니다(학기 고르개 아래 내용이 통째로 잘려 있었습니다).
//
// 그래서 `npm run build` 가 `scripts/check-bounded-scroll.mjs` 로 이 목록의 화면들이 실제로
// 자기 스크롤을 갖췄는지 봅니다. 게시판형이 아닌 긴 설정 화면은 **이 목록에 넣지 않는 것**이
// 맞습니다 - 가두는 것이 목적이 아니라 목록을 페이지로 넘겨 보는 것이 목적입니다.
const BOUNDED_LIST_PATHS = [
  "/records",
  "/meetings",
  "/events",
  "/proposals",
  "/adopted",
  "/manuals",
  "/documents",
  "/school/documents",
  "/school/documents/reports",
  "/academic-calendar",
  "/inquiries",
  "/admin/users",
  "/ops",
  "/students",
  "/shuttle",
  "/shuttle/regions",
  "/shuttle/routes",
  "/shuttle/students",
  "/terms",
  "/weekly-report/admin/students",
  "/weekly-report/admin/subjects",
];

// 인보이스 명단·학비 청구는 **가로만** 가둡니다.
//
// 처음에는 화면 높이에 통째로 가뒀습니다. 그러면 표 안쪽에서 세로로도 스크롤해야 하는데,
// 학생이 백 명 넘는 표에서는 그게 더 불편합니다 - 명단은 위에서 아래로 쭉 훑어 내리는
// 것이라 페이지째 내려가는 편이 자연스럽습니다.
//
// 옆으로 길어지는 것만 막으면 됩니다. 안 막으면 항목이 늘 때 페이지가 통째로 늘어나
// 상단 탭줄과 제목까지 밀려 나갑니다.
const WIDE_TABLE_PATHS = ["/finance/invoices", "/finance/tuition"];

export default function MainArea({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWork = pathname?.startsWith("/work");
  // 주간 관찰기록은 교사용 화면이라 배경색이 따로 있습니다(bg-wr-bg). 그런데 명부 관리·
  // 반 배정은 «학교» 메뉴에 걸린 행정 화면인데 주소만 /weekly-report 아래에 있어서, 들어가면
  // 배경이 갑자기 초록으로 바뀌었습니다. 주소가 아니라 **어느 메뉴의 화면인가**로 갈라야 합니다.
  const isWeekly = pathname?.startsWith("/weekly-report") && !pathname?.startsWith("/weekly-report/admin");
  const isStaffManual = pathname?.startsWith("/staff-manual");
  const isBoundedList = BOUNDED_LIST_PATHS.some((p) => pathname === p);

  // 업무 보드는 칸반이 화면을 꽉 채워야 해서 예전에는 여백이 아예 없었는데, 그러면 상단탭이
  // 페이지 내용에 딱 붙어 답답합니다(요청 ③: "업무탭부분 너무 페이지랑 가까워 조금 여유는 줘").
  // 좌우는 상단탭과 같은 px를 써서 왼쪽 선을 맞추고, 위쪽에만 작은 숨통을 둡니다.
  if (isWork) {
    return <main className="workflatform-theme flex-1 overflow-hidden px-4 pb-3 pt-3 sm:px-6 sm:pb-4">{children}</main>;
  }

  // 실무자매뉴얼은 좌(매뉴얼)/우(학생검색) 두 영역이 각자 스크롤되며 화면 안에 같이 떠 있어야
  // 전화 응대 중 둘 다 스크롤 없이 훑어보기 편해서, 다른 페이지와 달리 높이를 뷰포트에 맞춥니다.
  if (isStaffManual) {
    return <main className="shell-content shell-content-bg flex-1 overflow-hidden p-4 sm:p-6">{children}</main>;
  }

  if (isBoundedList) {
    return (
      <main className={"flex-1 overflow-hidden p-4 sm:p-6 " + (isWeekly ? "bg-wr-bg" : "shell-content shell-content-bg")}>
        {children}
      </main>
    );
  }

  // 넓은 표: 세로는 페이지째 내려가고, 가로만 표 안에서 스크롤합니다.
  // `min-w-0` 이 있어야 안쪽 표가 넓어질 때 이 칸이 함께 늘어나지 않습니다.
  if (WIDE_TABLE_PATHS.some((p) => pathname === p)) {
    return <main className="shell-content shell-content-bg min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>;
  }

  // 좌우 여백(sm:p-6)은 상단탭바의 sm:px-6과 같은 값입니다. 예전에는 여기만 sm:p-8이라
  // 탭바보다 본문이 더 안쪽에서 시작해, 화면을 옮길 때마다 탭 위치가 어긋나 보였습니다(요청 ④).
  return (
    <main className={"flex-1 overflow-x-hidden p-4 sm:p-6 " + (isWeekly ? "bg-wr-bg" : "shell-content shell-content-bg")}>
      {children}
    </main>
  );
}
