import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import MyClassClient from "@/components/myClass/MyClassClient";

export const dynamic = "force-dynamic";

// 교사 로그인 첫 화면(요청: "교사 권한으로 로그인했을때 (...) 제일 첫화면으로 나오는 대시보드").
// 우리 반 학부모 문의와 오늘 픽업(시각 명시분)을 한눈에 보여줍니다. 실제 데이터는 클라이언트가
// /api/my-class를 주기적으로 불러 가져옵니다(다른 대시보드와 같은 패턴).
export default async function MyClassPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  // 담임 배정이 없는 과목 교사는 볼 반이 없으므로 위클리 리포트로 보냅니다("담임 선생님" 전용).
  if (isTeacherOnly(me)) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("wr_classes")
      .select("id", { count: "exact", head: true })
      .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`);
    if ((count ?? 0) === 0) redirect("/weekly-report");
  }

  return <MyClassClient />;
}
