// 리포트는 "주간" 단위입니다 - 원본 앱의 소스에는 정확한 주차 판별 로직이 없어서(대시보드
// 파일이 핸드오프 문서에 포함되지 않음), 월요일~일요일을 한 주로 보고 그 범위 안에 이미 쓴
// 리포트가 있으면 그것을 계속 수정하고, 없으면 새로 만드는 방식으로 구현했습니다.
export function getWeekRange(base: Date = new Date()): { start: string; end: string } {
  const d = new Date(base);
  const day = d.getDay(); // 0(일) ~ 6(토)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}
