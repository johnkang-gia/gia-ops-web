"use client";

import { usePathname } from "next/navigation";

// 세 앱(업무/운영/위클리 리포트)이 합쳐져 있다는 걸 항상 인지할 수 있도록, 지금 보고 있는
// 화면이 어느 섹션인지에 따라 배경 톤(과 업무 탭의 경우 완전히 다른 글래스모피즘 테마)을
// 다르게 적용합니다. 사이드바 자체는 항상 흰색으로 고정해 로고와 부딪히지 않게 하고, 구분은
// 오직 본문 영역에서만 이뤄집니다.
export default function MainArea({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWork = pathname?.startsWith("/work");
  const isWeekly = pathname?.startsWith("/weekly-report");

  if (isWork) {
    return <main className="workflatform-theme flex-1 overflow-hidden">{children}</main>;
  }

  return (
    <main className={"flex-1 overflow-x-hidden p-4 sm:p-8 " + (isWeekly ? "bg-wr-bg" : "bg-gia-bg")}>
      {children}
    </main>
  );
}
