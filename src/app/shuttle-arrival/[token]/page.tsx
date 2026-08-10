import ArrivalCheckClient from "@/components/shuttle/ArrivalCheckClient";

export const dynamic = "force-dynamic";

// 교직원용 도착·출발 체크 단독 화면 - 로그인 없이 토큰 링크 하나로 접속합니다(요청: "교직원이
// 모바일로 도착한 차량 누를 수 있는 단독 링크"). 실제 데이터는 클라이언트가
// /api/shuttle/arrival/[token]을 폴링해서 가져옵니다(안내보드·파일럿 체크인과 같은 패턴).
export default async function ShuttleArrivalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ArrivalCheckClient token={token} />;
}
