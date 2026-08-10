import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import Link from "next/link";
import type { ShuttleRoute, ShuttlePilotRoute } from "@/lib/types";
import ShuttleLiveClient, { type LiveRosterItem } from "@/components/shuttle/ShuttleLiveClient";

export const dynamic = "force-dynamic";

// 교직원 전체(교사 포함)가 로그인만 하면 볼 수 있는 실시간 셔틀 화면입니다(요청: "교직원들이
// 등원과 하원셔틀의 실시간 위치를 바로 알 수 있고, 하원 차량에 학생들을 탑승하라고 안내하고,
// 탑승확인하는 용도로 사용"). 링크 발급·토큰 관리는 여전히 관리자 전용 /shuttle/pilot에서
// 이루어지고, 이 화면은 그 결과(위치·탑승현황)를 보고 '현장도착'만 체크하는 조회+확인 화면입니다.
export default async function ShuttleLivePage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  // 요청: "등원은 패스하고 하원만 진행되도록 우선 만들어줘" - 지금은 하원 노선만 보여줍니다.
  // term='정규학기'로 한정해서, 여름캠프2 같은 학기 외 임시 노선은 여기 섞이지 않습니다
  // (요청: "지금데이터는 정규학기에 사용할예정으로 분류해주고" - 캠프는 별도 도착체크 단독
  // 링크·안내보드로 운영합니다).
  const routesRes = await supabase
    .from("shuttle_routes")
    .select("*")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", "정규학기")
    .order("sort_order");
  const routes = (routesRes.data as ShuttleRoute[] | null) ?? [];
  const routeIds = routes.map((r) => r.id);
  const pilotsRes =
    routeIds.length > 0
      ? await supabase.from("shuttle_pilot_routes").select("*").in("route_id", routeIds).order("created_at", { ascending: false })
      : { data: [] as ShuttlePilotRoute[] };

  // 안내보드 링크(로그인 없는 토큰 링크) - 활성화된 링크 중 가장 최근 것을 "안내보드 열기"
  // 버튼에 연결합니다(요청: "교직원도 모바일로 차량상황 띄워놓고..."의 연장선 - 로비 화면을
  // 여기서 바로 열 수 있어야 함). 관리자는 /shuttle/pilot에서 여러 개를 만들고 관리할 수 있습니다.
  const boardLinkRes = await supabase
    .from("shuttle_board_links")
    .select("token, label")
    .eq("enabled", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const boardLink = boardLinkRes.data as { token: string; label: string } | null;

  let stopsData: { id: string; route_id: string; seq: number; stop_time: string | null }[] = [];
  let assignmentsData: { id: string; stop_id: string; student_name_raw: string; weekdays: number[] }[] = [];
  if (routeIds.length > 0) {
    const stopsRes = await supabase.from("shuttle_stops").select("id, route_id, seq, stop_time").in("route_id", routeIds).order("seq");
    stopsData = stopsRes.data ?? [];
    const stopIds = stopsData.map((s) => s.id);
    if (stopIds.length > 0) {
      const assignRes = await supabase.from("shuttle_assignments").select("id, stop_id, student_name_raw, weekdays").in("stop_id", stopIds);
      assignmentsData = assignRes.data ?? [];
    }
  }

  // 오늘 요일(1=월...5=금)에 배정된 학생만 골라 평평한 목록으로 넘깁니다(체크인 화면과 같은
  // 필터 기준). 어느 노선 카드에 보일지는 클라이언트에서 override_route_id(하원 체크표에서
  // 오늘 하루만 옮긴 경우)를 폴링해가며 다시 묶습니다 - 요청: "표안에서 아이들의 이름을
  // 자유롭게 끌어서 이동할 수 있게" 했을 때 이 화면에도 바로 반영되도록.
  const todayWeekday = new Date().getDay();
  const stopById = new Map(stopsData.map((s) => [s.id, s]));
  const allRoster: LiveRosterItem[] = [];
  for (const a of assignmentsData) {
    if (!a.weekdays.includes(todayWeekday)) continue;
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    allRoster.push({ assignmentId: a.id, studentName: a.student_name_raw, stopSeq: stop.seq, stopTime: stop.stop_time, routeId: stop.route_id });
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🚌 실시간 셔틀 (하원)</h1>
        {boardLink ? (
          <Link
            href={`/shuttle-board/${boardLink.token}`}
            target="_blank"
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            📺 안내보드 열기
          </Link>
        ) : (
          <span className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-300">
            📺 안내보드 미설정
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-500">
        하원 노선의 실시간 위치와 탑승 현황입니다(등원은 추후 지원 예정). 차량이 학교에 도착하면 &apos;현장도착&apos;을 눌러 학생들에게 안내해주세요. 복도·로비
        화면에는 위 &apos;안내보드 열기&apos; 링크를 띄워두면 도착한 차량과 탑승할 학생이 자동으로 표시됩니다.
      </p>
      <ShuttleLiveClient
        routes={routes}
        pilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []}
        allRoster={allRoster}
        userLabel={me.name || me.email}
      />
    </div>
  );
}
