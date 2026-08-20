import OpsBoardClient from "@/components/opsBoard/OpsBoardClient";

export const dynamic = "force-dynamic";

// 사무실 대형 모니터용 통합 운영 대시보드 - 로그인 없이 토큰 링크 하나로 띄워둡니다(요청:
// "큰 모니터에 띄워서 전체가 한눈에 보고 파악할 수 있는 통합 대시보드", 접속은 "로그인 없는
// 전용 링크"). 화면 절반은 CCTV, 나머지 절반에 이 페이지를 띄우는 구성을 전제로 합니다.
export default async function OpsBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OpsBoardClient token={token} />;
}
