import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function WeeklyReportLandingPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const email = me.email;

  // 미리보기 중이 아닐 때만 개발자 전용 지름길을 씁니다 - 미리보기 중에는(요청: "그 권한에서만
  // 볼 수 있는 화면으로") 아래 실제 직위 기준 분기(관리자/행정직원 → 학생현황, 교사 → 담임/
  // 담당과목)를 그대로 타야 합니다.
  if (isDeveloperEmail(email) && !me.previewOf) redirect("/weekly-report/students");

  if (me.position === "관리자" || me.position === "행정직원") {
    redirect("/weekly-report/students");
  }

  // 주간 리포트는 담임 선생님만 작성합니다(요청 3: 내 과목 없애고 담임만). 담임반이 있으면
  // 담임 리포트로, 없으면(과목 선생님) 내 시간표 개요로 보냅니다.
  const { data: classes } = await supabase
    .from("wr_classes")
    .select("id")
    .or(`teacher_email.eq.${email},sub_teacher_email.eq.${email}`);

  if ((classes?.length ?? 0) > 0) redirect("/weekly-report/homeroom");
  redirect("/my-class");
}
