import ShuttleTabs from "@/components/shuttle/ShuttleTabs";

// 셔틀 섹션 공용 레이아웃(요청: "다른 탭을 누르면 그냥 페이지로 이동해서 다시 개요로 와야
// 한다 → 탭으로 이동할 수 있게"). 탭바를 이 레이아웃에 두면 /shuttle/* 사이를 오갈 때
// Next.js가 레이아웃(탭바)은 그대로 두고 아래 내용만 바꿔치기하므로, 셸을 벗어나지 않고
// 탭처럼 전환됩니다. 앞으로 다른 대분류(학교·업무)의 개요+탭도 같은 방식(섹션 layout에 탭바)을
// 씁니다. 탭바는 고정, 그 아래 영역만 스크롤됩니다.
export default function ShuttleSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="w-full shrink-0 px-4 pt-1 sm:px-6">
        <ShuttleTabs />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
