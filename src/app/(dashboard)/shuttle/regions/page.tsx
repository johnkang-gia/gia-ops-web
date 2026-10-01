import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadShuttleWorld } from "@/lib/shuttleWorld";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
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

  // 거르는 규칙(학기·켠 노선·딸린 정류장·배정)은 shuttleWorld 한 곳입니다.
  const world = await loadShuttleWorld(supabase, { assignments: "basic" });

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
          routes={world.routes}
          stops={world.stops}
          assignments={world.assignments}
        />
      </div>
    </div>
  );
}
