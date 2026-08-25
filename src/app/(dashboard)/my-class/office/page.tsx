import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDemoAccount } from "@/lib/sharedAccounts";
import OfficeRequestClient from "@/components/teacher/OfficeRequestClient";

export const dynamic = "force-dynamic";

// 담임/과목 선생님 → 행정실 문의 창구(요청 4). 여기서 남긴 글은 업무 대시보드 상단에 실시간으로
// 뜨고, 해당 반에 빨간 느낌표로 표시됩니다.
export default async function OfficeRequestPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const supabase = await createClient();
  const demo = isDemoAccount(me.email);
  const { count } = await supabase
    .from("wr_classes")
    .select("id", { count: "exact", head: true })
    .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
    .eq("is_demo", demo);
  const isHomeroom = (count ?? 0) > 0;

  return (
    <div className="p-4 sm:p-6">
      <OfficeRequestClient isHomeroom={isHomeroom} />
    </div>
  );
}
