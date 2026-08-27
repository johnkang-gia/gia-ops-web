import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_SHUTTLE_TERM } from "@/lib/shuttleTerm";
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

// 지금 쓰는 학기. 여름캠프2가 끝난 뒤로 운영은 정규학기 하나뿐입니다.
const TERM = CURRENT_SHUTTLE_TERM;

export default async function ShuttleAssignmentsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const [routesRes, stopsRes, asgRes, studentsRes] = await Promise.all([
    // 학기와 사용여부로 걸러냅니다.
    //
    // 담당자: "탑승 배정에 중복 차들이 많고 이전 데이터에 중복되는 것 같아."
    //
    // 맞습니다. 이 화면은 지금까지 **모든 학기, 꺼둔 노선까지 전부** 불러왔습니다.
    // 여름캠프2 노선이 남아 있으면 같은 호차가 두 번씩 보입니다 - 하원 체크표는
    // term으로 거르는데 여기만 안 걸렀습니다. 같은 자료를 두 화면이 다르게 보고
    // 있었던 셈입니다.
    supabase.from("shuttle_routes").select("*").eq("term", TERM).eq("active", true).order("direction").order("sort_order"),
    supabase.from("shuttle_stops").select("*").order("seq"),
    supabase.from("shuttle_assignments").select("*"),
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
