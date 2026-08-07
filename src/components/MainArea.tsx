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
// Pagination 컴포넌트로 "1 2 3" 페이지를 넘겨보게 했습니다. 각 페이지의 클라이언트 컴포넌트가
// 스스로 h-full/overflow-hidden 구조를 갖추고 있다는 전제이므로, 여기서는 <main> 높이만
// 뷰포트에 맞게 잡아줍니다.
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
  "/weekly-report/admin/classes",
  "/weekly-report/admin/subjects",
];

export default function MainArea({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWork = pathname?.startsWith("/work");
  const isWeekly = pathname?.startsWith("/weekly-report");
  const isStaffManual = pathname?.startsWith("/staff-manual");
  const isBoundedList = BOUNDED_LIST_PATHS.some((p) => pathname === p);

  if (isWork) {
    return <main className="workflatform-theme flex-1 overflow-hidden">{children}</main>;
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

  return (
    <main className={"flex-1 overflow-x-hidden p-4 sm:p-8 " + (isWeekly ? "bg-wr-bg" : "shell-content shell-content-bg")}>
      {children}
    </main>
  );
}
