import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { ShuttleAssignment, ShuttleRoute, ShuttleStop } from "@/lib/types";
import RouteManageClient from "@/components/shuttle/RouteManageClient";
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

export default async function ShuttleRoutesPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const [routesRes, stopsRes, asgRes] = await Promise.all([
    supabase.from("shuttle_routes").select("*").order("direction").order("sort_order"),
    supabase.from("shuttle_stops").select("*").order("seq"),
    supabase.from("shuttle_assignments").select("id, stop_id"),
  ]);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden">
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
        <RouteManageClient
          initialRoutes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          initialStops={(stopsRes.data as ShuttleStop[] | null) ?? []}
          assignmentCounts={(asgRes.data as Pick<ShuttleAssignment, "id" | "stop_id">[] | null) ?? []}
        />
      </div>
    </div>
  );
}
