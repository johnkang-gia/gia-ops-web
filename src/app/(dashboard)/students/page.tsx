import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { WrStudent } from "@/lib/types";
import StudentSearchClient from "@/components/students/StudentSearchClient";

export const dynamic = "force-dynamic";

// 행정직원/관리자(+개발자)만 접근 가능합니다 - 교사는 자기 담당 학생의 위클리 리포트만 보고,
// 여기서는 학교 전체 학생의 사건기록·업무언급까지 한 번에 볼 수 있어 접근을 좁혀둡니다.
export default async function StudentsSearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const email = (user.email ?? "").toLowerCase();
  if (!isDeveloperEmail(email)) {
    const { data: me } = await supabase.from("app_users").select("position").eq("email", email).maybeSingle();
    if (me?.position !== "관리자" && me?.position !== "행정직원") redirect("/home");
  }

  const { data } = await supabase
    .from("wr_students")
    .select("*")
    .eq("status", "active")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-lg font-bold">학생 정보 조회</h1>
      <p className="mb-4 text-xs text-slate-500">
        업무 · 사건기록 · 위클리 리포트에서 같은 학생은 항상 같은 학번(고유번호)으로 관리됩니다.
        이름이나 학번으로 검색해 그 학생의 인적사항·학적사항·관련 기록을 한 화면에서 확인하세요.
      </p>
      <StudentSearchClient students={(data as WrStudent[] | null) ?? []} />
    </div>
  );
}
