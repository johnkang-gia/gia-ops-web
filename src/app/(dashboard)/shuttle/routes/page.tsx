import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadShuttleWorld } from "@/lib/shuttleWorld";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { WrStudent } from "@/lib/types";
import RouteManageClient, { type RouteAssignment } from "@/components/shuttle/RouteManageClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🛣️ 노선 관리란?",
    lines: [
      "셔틀 노선을 추가·수정·삭제하고, 노선마다 정류장을 순서대로 관리합니다.",
      "지입차량이라 기사님·차량번호·동승 선생님이 바뀌면 여기서 바로 고쳐주세요.",
    ],
  },
  {
    title: "🚏 정류장",
    lines: [
      "정류장은 위에서부터 차가 도는 순서입니다. ↑↓ 버튼으로 순서를 바꿀 수 있습니다.",
      "정류장을 지우면 그 정류장에 배정된 학생 배정도 함께 사라지니 주의해주세요.",
    ],
  },
];

export const dynamic = "force-dynamic";

// 지금 쓰는 학기. 여름캠프2가 끝난 뒤로 운영은 정규학기 하나뿐입니다.

export default async function ShuttleRoutesPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const [world, studentsRes] = await Promise.all([
    // 노선 관리는 고치는 화면이라 대기(꺼둔) 노선도 봅니다. 운영 화면은 켠 노선만 봅니다.
    loadShuttleWorld(supabase, { includeDormant: true, assignments: "full" }),
    supabase.from("wr_students").select("id, name, grade, class_name").eq("status", "active").eq("is_demo", false).order("name"),
  ]);

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">🛣️ 노선 관리</h1>
          <GuideButton title="노선 관리 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-3 text-xs text-slate-500">
          노선과 정류장을 추가·수정하고, 기사님·차량번호·동승 선생님을 관리합니다.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {world.errors.length > 0 && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">일부 자료를 못 읽었습니다: {world.errors.join(" · ")}</p>}
        <RouteManageClient
          initialRoutes={world.routes}
          initialStops={world.stops}
          assignmentCounts={world.assignments as RouteAssignment[]}
          assignments={world.assignments}
          students={(studentsRes.data as Pick<WrStudent, "id" | "name" | "grade" | "class_name">[] | null) ?? []}
        />
      </div>
    </div>
  );
}
