import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { ShuttleAssignment, ShuttleRoute, ShuttleStop } from "@/lib/types";
import ShuttleClient from "@/components/shuttle/ShuttleClient";
import ShuttleTermTabs from "@/components/shuttle/ShuttleTermTabs";
import { parseShuttleTerm } from "@/lib/shuttleTerm";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🚌 셔틀 관리란?",
    lines: [
      "등원·하원 노선과 정류장, 그리고 어떤 학생이 무슨 요일에 어디서 타는지를 관리합니다.",
      "요일별로 내리는 곳이 다른 학생은 같은 이름으로 여러 줄이 있을 수 있습니다(월수는 학원, 화목은 집 등).",
    ],
  },
  {
    title: "🖨️ 배차표",
    lines: [
      "노선을 고르고 [배차표 인쇄]를 누르면 기존에 쓰시던 표 형태로 인쇄·PDF 저장할 수 있습니다.",
      "지입차량이라 기사님·차량번호·동승 선생님이 바뀌면 노선 정보에서 바로 고쳐주세요.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function ShuttlePage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const { term: termParam } = await searchParams;
  const term = parseShuttleTerm(termParam);

  // 학기로 가릅니다.
  //
  // 담당자: "배차표도 여름캠프 차량이 그대로 있어."
  // 지난 학기 노선은 **지우지 않습니다** - 그때 누가 몇 호차를 탔는지가 전부 거기 매달려
  // 있어서, 지우면 지난 학기 기록이 통째로 미아가 됩니다. 대신 기본은 현재 학기만 보고,
  // 위 탭으로 지난 학기를 꺼내 봅니다.
  const routesRes = await supabase
    .from("shuttle_routes")
    .select("*")
    .eq("term", term)
    .eq("active", true)
    .order("direction")
    .order("sort_order");
  const routeIds = (routesRes.data ?? []).map((r) => r.id as string);

  // 정류장·배정도 그 학기 노선의 것만. 예전에는 전부 불러와 여름캠프 정류장이 섞였습니다.
  const [stopsRes, asgRes] =
    routeIds.length > 0
      ? await Promise.all([
          supabase.from("shuttle_stops").select("*").in("route_id", routeIds).order("seq"),
          supabase.from("shuttle_assignments").select("*"),
        ])
      : [{ data: [] as ShuttleStop[] }, { data: [] as ShuttleAssignment[] }];

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">🚌 셔틀 관리</h1>
          <div className="flex items-center gap-2">
            <ShuttleTermTabs term={term} />
            <GuideButton title="셔틀 관리 사용 가이드" sections={GUIDE_SECTIONS} />
          </div>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          등원·하원 노선과 정류장, 요일별 탑승 학생을 관리하고 배차표를 인쇄합니다.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <ShuttleClient
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          stops={(stopsRes.data as ShuttleStop[] | null) ?? []}
          assignments={(asgRes.data as ShuttleAssignment[] | null) ?? []}
          canEdit={isStaffOrAboveUser(me)}
        />
      </div>
    </div>
  );
}
