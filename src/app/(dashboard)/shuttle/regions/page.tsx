import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_SHUTTLE_TERM } from "@/lib/shuttleTerm";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { ShuttleAssignment, ShuttleRoute, ShuttleStop } from "@/lib/types";
import ShuttleRegionDashboard from "@/components/shuttle/ShuttleRegionDashboard";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🗺️ 지역별 현황이란?",
    lines: [
      "노선 번호는 가는 지역을 묶어서 매겨져 있어, 특정 지역(예: 청담, 반포)에 몇 호차가 다니는지 지도에서 바로 찾을 수 있습니다.",
      "지도의 지역 표시나 오른쪽 지역 목록을 누르면 그 지역 가는 노선이 오른쪽에 뜨고, 검색창에 지명·아파트·도로명·차호수를 입력하면 지도와 아래 전체 목록이 함께 걸러집니다.",
      "지역 태그는 노선 관리에서 수정할 수 있습니다. 자동으로 채워둔 값이 실제와 다르면 그쪽에서 고쳐주세요.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function ShuttleRegionsPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const [routesRes, stopsRes, asgRes] = await Promise.all([
    // 지금 학기 노선만(여름캠프 노선이 섞이면 지역별 인원이 두 배로 보입니다).
    supabase.from("shuttle_routes").select("*").eq("term", CURRENT_SHUTTLE_TERM).eq("active", true).order("direction").order("sort_order"),
    supabase.from("shuttle_stops").select("*").order("seq"),
    supabase.from("shuttle_assignments").select("id, stop_id"),
  ]);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">🗺️ 셔틀 지역별 현황</h1>
          <GuideButton title="지역별 현황 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-3 text-xs text-slate-500">지역을 고르면 그 지역을 가는 셔틀이, 검색하면 관련 노선이 걸러집니다.</p>
      </div>
      <div className="min-h-0 flex-1">
        <ShuttleRegionDashboard
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          stops={(stopsRes.data as ShuttleStop[] | null) ?? []}
          assignments={(asgRes.data as Pick<ShuttleAssignment, "id" | "stop_id">[] | null) ?? []}
        />
      </div>
    </div>
  );
}
