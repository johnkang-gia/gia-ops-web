import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import DismissalBulkClient, { type PlanRow, type StudentLite } from "@/components/work/DismissalBulkClient";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "🎒 하원수단이란?",
    lines: [
      "요일마다 아이가 어떻게 집에 가는지입니다. 셔틀 · 학원차 · 보호자픽업 · 도보 · 기타.",
      "셔틀을 타지 않는 날은 하원 체크표에 줄이 아예 없어서, 여기 적어두지 않으면 어디에도 남지 않습니다.",
      "여기 적어두면 오늘 요일 것이 중앙 대시보드와 업무보드 [출결내역] 위에 저절로 뜹니다.",
    ],
  },
  {
    title: "한 번에 넣기",
    lines: [
      "형제자매처럼 같은 차를 타는 아이는 함께 골라 한 번에 넣습니다.",
      "요일도 여러 개 고를 수 있습니다 - 월·금 같은 학원차는 두 요일을 함께 찍으면 끝납니다.",
      "이미 넣어둔 요일이 있으면 덮어씁니다. 한 아이의 한 요일에는 하원수단이 하나뿐입니다.",
    ],
  },
];

export default async function DismissalBulkPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 담임도 학부모에게 직접 듣는 경우가 많아 고칠 수 있어야 합니다. 행정실을 거쳐야만
  // 고칠 수 있으면 결국 아무도 안 고쳐서 낡은 값이 남습니다.
  if (!isStaffOrAboveUser(me)) redirect("/");

  const [{ data: students }, { data: plans }] = await Promise.all([
    supabase
      .from("wr_students")
      .select("id, name, grade, class_name")
      .eq("status", "active")
      .eq("is_demo", false)
      .order("grade")
      .order("class_name")
      .order("name"),
    supabase.from("student_dismissal_plans").select("id, student_id, weekday, kind, label, depart_time, note"),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🎒 하원수단</h1>
        <GuideButton title="하원수단 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        요일마다 아이가 어떻게 집에 가는지 적습니다. <b>셔틀을 타지 않는 날</b>은 하원 체크표에 줄이 없어서, 여기
        적어두지 않으면 어디에도 남지 않습니다. 넣어두면 오늘 요일 것이 중앙 대시보드와 업무보드 [출결내역] 위에
        저절로 뜹니다.
      </p>

      <DismissalBulkClient
        students={((students as StudentLite[] | null) ?? [])}
        initialPlans={((plans as PlanRow[] | null) ?? [])}
      />
    </div>
  );
}
