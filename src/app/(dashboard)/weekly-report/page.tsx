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

  // 교사 - 담임반이 있으면 담임반으로, 없으면 담당과목으로, 둘 다 없으면 안내 메시지.
  const [{ data: classes }, { data: subjects }] = await Promise.all([
    supabase.from("wr_classes").select("id").or(`teacher_email.eq.${email},sub_teacher_email.eq.${email}`),
    supabase.from("wr_subjects").select("id").eq("teacher_email", email),
  ]);

  if ((classes?.length ?? 0) > 0) redirect("/weekly-report/homeroom");
  if ((subjects?.length ?? 0) > 0) redirect("/weekly-report/subjects");

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-lg font-semibold text-slate-700">아직 배정된 담임반/담당과목이 없습니다.</p>
      <p className="mt-2 text-sm text-slate-400">관리자에게 반 또는 과목 배정을 요청해주세요.</p>
    </div>
  );
}
