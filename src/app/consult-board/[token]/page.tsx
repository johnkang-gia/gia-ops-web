import ConsultBoardClient from "@/components/consult/ConsultBoardClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "상담 현황판" };

/**
 * 상담 현황판 — 로그인 없이 태블릿·전자칠판에 띄웁니다. 자료는 화면이 3초마다
 * `/api/consult/board/[token]` 에 묻고, 서버가 고른 칸(학년·이름·상담실·상태)만 받습니다.
 */
export default async function ConsultBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConsultBoardClient token={token} />;
}
