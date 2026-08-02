"use client";

import { usePathname } from "next/navigation";

// 세 앱(업무/운영/위클리 리포트)이 합쳐져 있다는 걸 항상 인지할 수 있도록, 지금 보고 있는
// 화면이 어느 섹션인지에 따라 배경 톤(과 업무 탭의 경우 완전히 다른 글래스모피즘 테마)을
// 다르게 적용합니다. 사이드바 자체는 항상 흰색으로 고정해 로고와 부딪히지 않게 하고, 구분은
// 오직 본문 영역에서만 이뤄집니다.
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
  "/inquiries",
  "/admin/users",
  "/students",
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
    return <main className="flex-1 overflow-hidden bg-gia-bg p-4 sm:p-6">{children}</main>;
  }

  if (isBoundedList) {
    return <main className={"flex-1 overflow-hidden p-4 sm:p-6 " + (isWeekly ? "bg-wr-bg" : "bg-gia-bg")}>{children}</main>;
  }

  return (
    <main className={"flex-1 overflow-x-hidden p-4 sm:p-8 " + (isWeekly ? "bg-wr-bg" : "bg-gia-bg")}>
      {children}
    </main>
  );
}
