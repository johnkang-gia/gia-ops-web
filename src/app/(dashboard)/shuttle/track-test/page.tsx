import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import TestTrackClient from "@/components/shuttle/TestTrackClient";

export const dynamic = "force-dynamic";

// 강경원 본인 휴대폰 GPS 테스트 화면(요청). 설치 링크·실시간 위치·오늘 이동 히스토리를 한 곳에서
// 봅니다. 관리자/행정직원만 접근할 수 있습니다.
export default async function TrackTestPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");
  return <TestTrackClient />;
}
