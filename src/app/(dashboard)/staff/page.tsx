import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser, isDeveloperEmail } from "@/lib/roles";
import type { AppUser } from "@/lib/types";
import StaffSearchClient from "@/components/staff/StaffSearchClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🧑‍💼 교직원 정보 조회란?",
    lines: [
      "학생 정보 조회와 같은 방식으로, 교직원 한 명의 입사일·퇴사일·연도별 담당 반/역할 이력을 한 화면에서 확인합니다.",
      "퇴사한 직원도 계정이 삭제되지 않는 한 기록이 계속 남아있어, 연도별로 누가 어느 반을 맡았는지 되짚어볼 수 있습니다.",
    ],
  },
  {
    title: "👀 접근 권한",
    lines: ["관리자·행정직원만 접근할 수 있습니다. 입사일/퇴사일·담당 이력 추가는 관리자만 할 수 있습니다."],
  },
];

export const dynamic = "force-dynamic";

export default async function StaffSearchPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  if (!isStaffOrAboveUser(me)) {
    redirect("/home");
  }

  const { data } = await supabase
    .from("app_users")
    .select("email, status, name, department, position, hire_date, leave_date")
    .order("name", { ascending: true });

  // 개발자 계정은 사용자 관리 화면과 마찬가지로 목록 자체에서 제외합니다.
  const staff = ((data as AppUser[] | null) ?? []).filter((u) => !isDeveloperEmail(u.email));

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">교직원 정보 조회</h1>
          <GuideButton title="교직원 정보 조회 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-4 text-xs text-slate-500">
          이름 또는 이메일로 검색해 그 교직원의 소속·직위·입사일과 연도별 담당 반/역할 이력을 한 화면에서 확인하세요.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <StaffSearchClient staff={staff} />
      </div>
    </div>
  );
}
