import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type {
  ShuttleRoute,
  ShuttlePilotRoute,
  ShuttleBoardLink,
  ShuttleArrivalLink,
  ShuttleTrackerDevice,
  ShuttleStop,
  ShuttleStopObservation,
} from "@/lib/types";
import PilotMonitorClient from "@/components/shuttle/PilotMonitorClient";
import BoardLinkManager from "@/components/shuttle/BoardLinkManager";
import ArrivalLinkManager from "@/components/shuttle/ArrivalLinkManager";
import TrackerDeviceManager from "@/components/shuttle/TrackerDeviceManager";
import TestTrackClient from "@/components/shuttle/TestTrackClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📍 실시간 위치란?",
    lines: [
      "타 셔틀앱 벤치마킹 제안서의 1단계(실시간 위치 전송, 운행 이벤트)를 정식 도입한 화면입니다. 우선은 하원 노선만 지원합니다(요청: '등원은 패스하고 하원만 진행'). 등원은 추후 별도로 도입합니다.",
      "동승선생님은 회사 계정 로그인 없이 링크 하나로 접속해, 학생 탑승을 먼저 확인한 뒤 '이동 시작'만 누르면 됩니다(기사님은 이번 단계에서는 별도로 앱을 쓰지 않습니다). 아래 목록에서 노선별 링크를 복사해 보내드리세요.",
      "체크인 화면 이동 중에는 휴대폰 가속도 센서로 급가속·급감속도 함께 감지해, 노선 카드에 '오늘 안전운행지수'로 보여드립니다(3단계-a).",
      "노선 카드의 '오늘 운행일지' 버튼을 누르면 그날의 출발·도착·소요시간·탑승현황·안전운행지수를 정리한 PDF가 자동으로 만들어집니다(3단계-b).",
      "이 화면은 링크 발급·관리 전용 관리자 화면입니다. 전체 교직원이 실시간 위치·탑승현황을 확인하는 화면은 왼쪽 메뉴의 '실시간 셔틀'을 이용해주세요.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function ShuttlePilotPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/shuttle");

  const supabase = await createClient();
  // 요청: "등원은 패스하고 하원만 진행되도록 우선 만들어줘" - 하원 노선만 링크 관리 대상으로
  // 보여줍니다(등원 노선/링크 자체는 DB에 남아있지만 이 화면에서는 노출하지 않습니다).
  // term='정규학기'만 대상으로 합니다(여름캠프2 같은 임시 노선은 섞이지 않게 분리).
  const routesRes = await supabase
    .from("shuttle_routes")
    .select("*")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", "정규학기")
    .order("sort_order");
  const routeIds = (routesRes.data ?? []).map((r) => r.id);
  const pilotsRes =
    routeIds.length > 0
      ? await supabase.from("shuttle_pilot_routes").select("*").in("route_id", routeIds).order("created_at", { ascending: false })
      : { data: [] as ShuttlePilotRoute[] };
  // 기사·차량 변경 이력(요청 채택). 트리거가 자동으로 쌓아둔 스냅샷을 최신순으로 보여줍니다.
  const historyRes =
    routeIds.length > 0
      ? await supabase
          .from("shuttle_route_vehicle_history")
          .select("route_no, driver_name, driver_phone, vehicle_no, teacher_name, note, changed_at")
          .in("route_id", routeIds)
          .order("changed_at", { ascending: false })
          .limit(200)
      : { data: [] as Record<string, unknown>[] };
  const history = (historyRes.data ?? []) as {
    route_no: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    vehicle_no: string | null;
    teacher_name: string | null;
    note: string | null;
    changed_at: string;
  }[];
  const boardLinksRes = await supabase.from("shuttle_board_links").select("*").order("created_at", { ascending: false });
  const arrivalLinksRes = await supabase.from("shuttle_arrival_links").select("*").order("created_at", { ascending: false });

  // Traccar(기사님 휴대폰 GPS) 등록 기기와, 그 위치에서 학습한 정류장 좌표·정차 관측을 함께
  // 불러옵니다. 관측은 최근 것만 봐도 충분해서 최신 200건으로 제한합니다.
  const devicesRes =
    routeIds.length > 0
      ? await supabase.from("shuttle_tracker_devices").select("*").in("route_id", routeIds).order("created_at", { ascending: false })
      : { data: [] as ShuttleTrackerDevice[] };
  const stopsRes =
    routeIds.length > 0 ? await supabase.from("shuttle_stops").select("*").in("route_id", routeIds).order("seq") : { data: [] as ShuttleStop[] };
  const observationsRes =
    routeIds.length > 0
      ? await supabase
          .from("shuttle_stop_observations")
          .select("*")
          .in("route_id", routeIds)
          .order("arrived_at", { ascending: false })
          .limit(200)
      : { data: [] as ShuttleStopObservation[] };

  // 링크·기기 개요(요청 ⑰: 한눈에 정보를 볼 수 있는 개요). 등록 기기·연결(최근 10분 내 신호)·
  // 미설치, 안내보드/도착 링크 수를 위에 요약합니다.
  const devices = (devicesRes.data as ShuttleTrackerDevice[] | null) ?? [];
  const nowMs = Date.now();
  const liveCount = devices.filter((d) => d.last_hit_at && nowMs - new Date(d.last_hit_at as unknown as string).getTime() < 10 * 60 * 1000).length;
  const unsetCount = devices.filter((d) => !d.last_hit_at).length;
  const boardLinkCount = (boardLinksRes.data ?? []).length;
  const arrivalLinkCount = (arrivalLinksRes.data ?? []).length;
  const stat = (label: string, value: number | string, tone = "#0f172a") => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-xl font-extrabold" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-none p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🔗 링크 · 기기 · GPS</h1>
        <GuideButton title="링크·기기 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        동승선생님용 링크와 기사님 GPS 기기를 관리하고, 내 폰으로 GPS를 테스트합니다.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stat("등록 기기", devices.length)}
        {stat("연결 중", liveCount, "#16a34a")}
        {stat("미설치·신호없음", unsetCount, unsetCount ? "#dc2626" : "#0f172a")}
        {stat("안내보드 링크", boardLinkCount)}
        {stat("도착 링크", arrivalLinkCount)}
      </div>
      <div className="flex flex-col gap-4">
        <BoardLinkManager initialLinks={(boardLinksRes.data as ShuttleBoardLink[] | null) ?? []} />
        <ArrivalLinkManager initialLinks={(arrivalLinksRes.data as ShuttleArrivalLink[] | null) ?? []} />
        <TrackerDeviceManager
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          initialDevices={(devicesRes.data as ShuttleTrackerDevice[] | null) ?? []}
          stops={(stopsRes.data as ShuttleStop[] | null) ?? []}
          observations={(observationsRes.data as ShuttleStopObservation[] | null) ?? []}
        />
        <PilotMonitorClient
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          initialPilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []}
        />
        {/* 기사·차량 변경 이력(요청 채택). 지입차량 교대·차량번호 변경을 자동 기록합니다. */}
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">🧾 기사 · 차량 변경 이력 ({history.length})</summary>
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-semibold">호차</th>
                  <th className="px-3 py-2 font-semibold">기사</th>
                  <th className="px-3 py-2 font-semibold">차량번호</th>
                  <th className="px-3 py-2 font-semibold">동승</th>
                  <th className="px-3 py-2 font-semibold">변경</th>
                  <th className="px-3 py-2 font-semibold">일시</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                      아직 기록이 없습니다. 노선의 기사·차량을 바꾸면 여기에 자동으로 남습니다.
                    </td>
                  </tr>
                ) : (
                  history.map((h, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-1.5 font-bold text-slate-700">{h.route_no ?? "-"}호</td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {h.driver_name ?? "-"}
                        {h.driver_phone ? <span className="ml-1 text-xs text-slate-400">{h.driver_phone}</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{h.vehicle_no ?? "-"}</td>
                      <td className="px-3 py-1.5 text-slate-600">{h.teacher_name ?? "-"}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-500">{h.note ?? ""}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">
                        {new Date(h.changed_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </details>

        {/* 내 폰 GPS 테스트(요청 ⑰: 링크·기기와 통합). 자주 쓰지 않으므로 접어둡니다. */}
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">🛰️ 내 폰 GPS 테스트 (강경원)</summary>
          <div className="border-t border-slate-100 p-2">
            <TestTrackClient />
          </div>
        </details>
      </div>
    </div>
  );
}
