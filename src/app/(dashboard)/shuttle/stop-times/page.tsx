import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import StopTimesClient from "@/components/shuttle/StopTimesClient";

export const dynamic = "force-dynamic";

// 정류장 도착 시간 기록·평균(요청). 관리자/행정직원만.
export default async function StopTimesPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");
  return <StopTimesClient />;
}
