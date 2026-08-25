import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { ShuttleAssignment, ShuttleRoute, ShuttleStop, WrStudent } from "@/lib/types";
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

export default async function ShuttleAssignmentsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const [routesRes, stopsRes, asgRes, studentsRes] = await Promise.all([
    supabase.from("shuttle_routes").select("*").order("direction").order("sort_order"),
    supabase.from("shuttle_stops").select("*").order("seq"),
    supabase.from("shuttle_assignments").select("*"),
    supabase.from("wr_students").select("id, name, grade, class_name").eq("status", "active").order("name"),
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
        <AssignmentClient
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          stops={(stopsRes.data as ShuttleStop[] | null) ?? []}
          initialAssignments={(asgRes.data as ShuttleAssignment[] | null) ?? []}
          students={(studentsRes.data as Pick<WrStudent, "id" | "name" | "grade" | "class_name">[] | null) ?? []}
        />
      </div>
    </div>
  );
}
