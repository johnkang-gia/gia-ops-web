import ShuttleBoardClient from "@/components/shuttle/ShuttleBoardClient";

export const dynamic = "force-dynamic";

// 안내보드 - 로비/복도 화면에 띄워두는 로그인 없는 전용 페이지입니다(요청: "운영앱에서
// 로그인하지 않고 별도의 페이지로 안내보드는 나오도록"). 실제 데이터는 클라이언트가
// /api/shuttle/board/[token]을 폴링해서 가져옵니다(shuttle-pilot 체크인 페이지와 같은
// 토큰 인증 패턴 - 회사 계정 세션이 없어도 이 링크 하나로 동작).
export default async function ShuttleBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShuttleBoardClient token={token} />;
}
