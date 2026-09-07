import type { Metadata } from "next";
import ClassroomTabletClient from "@/components/classroom/ClassroomTabletClient";

// 교실 태블릿 화면. 로그인 없이 반별 토큰 링크 하나로 엽니다.
//
// (dashboard) 밖에 두는 이유는 안내보드·도착체크와 같습니다 - 사이드바·메뉴·학기 표시가
// 필요 없고, 무엇보다 **로그인을 요구하면 안 됩니다.**
export const metadata: Metadata = {
  title: "교실",
  // 교실에 세워두는 화면이라 검색에 잡힐 이유가 없습니다.
  robots: { index: false, follow: false },
};

export default async function ClassroomPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClassroomTabletClient token={token} />;
}
