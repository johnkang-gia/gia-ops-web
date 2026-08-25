// 셔틀 섹션 공용 레이아웃. 상단 탭바는 이제 대시보드 레이아웃이 본문 위 한 자리에서 그리므로
// (요청 ④: "어떤 페이지를 보건 상단탭 자리는 고정해줘") 여기서는 스크롤 영역만 잡아줍니다.
// 셔틀 화면들은 지도·표가 화면 높이를 꽉 채워야 해서, 본문 전체가 늘어나는 대신 이 안쪽만
// 스크롤되도록 h-full + min-h-0 구조를 유지합니다.
export default function ShuttleSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
