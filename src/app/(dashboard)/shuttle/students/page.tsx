import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadShuttleWorld } from "@/lib/shuttleWorld";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { WrStudent } from "@/lib/types";
import AssignmentClient from "@/components/shuttle/AssignmentClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🧑‍🎓 탑승 배정이란?",
    lines: [
      "어떤 학생이 어느 노선·정류장에서 무슨 요일에 타는지를 관리합니다.",
      "학생 이름으로 찾으면 그 아이의 등원·하원 배정이 한눈에 보입니다.",
    ],
  },
  {
    title: "📅 요일별로 다른 경우",
    lines: [
      "월수는 학원, 화목은 집처럼 요일마다 내리는 곳이 다르면 배정을 두 줄로 나눠 각각 요일을 지정하세요.",
      "안 타는 요일은 체크를 풀면 그날 명단에서 자동으로 빠집니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// 지금 쓰는 학기. 여름캠프2가 끝난 뒤로 운영은 정규학기 하나뿐입니다.

export default async function ShuttleAssignmentsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const [world, studentsRes] = await Promise.all([
    // 대기(꺼둔) 노선도 함께 - 새로 온 아이를 빈 차에 넣는 자리입니다. 거르는 규칙은 shuttleWorld 한 곳.
    loadShuttleWorld(supabase, { includeDormant: true, assignments: "full" }),
    supabase.from("wr_students").select("id, name, grade, class_name").eq("status", "active").eq("is_demo", false).order("name"),
  ]);

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">🧑‍🎓 탑승 배정</h1>
          <GuideButton title="탑승 배정 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-3 text-xs text-slate-500">
          학생별로 등원·하원 노선과 정류장, 타는 요일을 관리합니다.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {world.errors.length > 0 && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">일부 자료를 못 읽었습니다: {world.errors.join(" · ")}</p>}
        <AssignmentClient
          routes={world.routes}
          stops={world.stops}
          initialAssignments={world.assignments}
          students={(studentsRes.data as Pick<WrStudent, "id" | "name" | "grade" | "class_name">[] | null) ?? []}
        />
      </div>
    </div>
  );
}
