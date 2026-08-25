import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 주간 리포트는 담임 선생님만 작성합니다(요청 3: 내 과목 없애기). 과목 선생님이 예전 링크로
// 들어오면 내 시간표 개요로 보냅니다.
export default async function WeeklyReportSubjectsPage() {
  redirect("/my-class");
}
