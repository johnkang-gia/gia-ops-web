import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import GpsStatusClient from "@/components/shuttle/GpsStatusClient";
import PilotMonitorClient from "@/components/shuttle/PilotMonitorClient";
import GuideButton from "@/components/common/GuideButton";
import type { ShuttleRoute, ShuttlePilotRoute } from "@/lib/types";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "📡 GPS 현황이란?",
    lines: [
      "GPS를 켜둔 차량 전부를 한 줄씩 늘어놓은 상태판입니다. 운행 중에 '어느 차가 살아 있고 어디까지 왔는지'를 한눈에 봅니다.",
      "링크·기기 화면은 기기를 발급하고 설정 링크를 보내는 곳입니다. 이 화면은 이미 돌아가는 것을 지켜보는 곳입니다.",
      "10초마다 저절로 갱신됩니다.",
    ],
  },
  {
    title: "🔍 각 칸이 말하는 것",
    lines: [
      "마지막 신호 — 5분 안이면 초록 점입니다. 오래되면 앱이 꺼졌거나 음영지역입니다.",
      "가장 긴 끊김 — 5분이 넘으면 빨간색. 그 사이에 지나간 정류장은 아무 기록도 남지 않습니다.",
      "오늘 정류장 — 오늘 도착이 찍힌 정류장 수 / 전체 정류장 수입니다.",
      "정류장 좌표 — 초록(학습)이 늘어날수록 도착 판정 반경이 좁아지고 정확해집니다.",
      "마지막 처리 — 서버가 마지막 위치를 어떻게 판단했는지 그대로 적습니다.",
    ],
  },
  {
    title: "📍 정류장 좌표는 저절로 정확해집니다",
    lines: [
      "지금 정류장 좌표는 아파트 주소를 지도로 옮긴 값이라 단지 한가운데를 가리킵니다. 차는 정문·후문·상가 앞에 섭니다.",
      "그래서 처음에는 반경 500m로 넓게 열어 기록부터 모읍니다. 좁게 잡으면 아무것도 안 들어와서 고칠 재료조차 생기지 않습니다.",
      "밤마다 도는 학습이 '여러 날 같은 자리에 선 곳'만 골라 정류장 좌표를 갱신합니다. 3일 이상 반복되면 반경이 200m로, 그다음 80m로 좁아집니다.",
      "신호대기와 정류장은 하루치로는 구별되지 않습니다. 신호는 어떤 날은 서고 어떤 날은 지나가지만, 정류장은 거의 매일 섭니다.",
    ],
  },
  {
    title: "⏰ 추적 시간대",
    lines: [
      "평일 오후 3시 30분 ~ 6시 30분에만 위치를 저장합니다. 그 밖의 시간에 들어온 좌표는 서버가 받아서 버립니다.",
      "기사님 개인 휴대폰이라 운행과 무관한 시간의 동선은 남기지 않습니다. 그래서 그 시간 밖에는 모든 숫자가 0인 것이 정상입니다.",
    ],
  },
];

// GPS 현황 - 요청: "링크·기기에 있는 GPS 연결차 보고 있는데, 따로 탭을 만들어서 쭉 볼 수 있게."
export default async function ShuttleGpsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  // 실시간 지도 + 수신 지표 패널(예전 링크·기기 아래 'GPS 연결 N').
  // 담당자: "지도랑 같이 마지막 수신, 최근 10분 수신 등등이 나와 있는 거 - 한눈에 보고 싶어."
  const supabase = await createClient();
  const routesRes = await supabase
    .from("shuttle_routes")
    .select("*")
    .eq("term", "정규학기")
    .eq("active", true)
    .eq("direction", "하원")
    .order("sort_order");
  const routeIds = (routesRes.data ?? []).map((r) => r.id as string);
  const pilotsRes =
    routeIds.length > 0
      ? await supabase.from("shuttle_pilot_routes").select("*").in("route_id", routeIds).order("created_at", { ascending: false })
      : { data: [] as ShuttlePilotRoute[] };

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">📡 GPS 현황</h1>
          <GuideButton title="GPS 현황 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-3 text-xs text-slate-500">
          GPS를 켜둔 차량의 신호·정류장 인식 상태를 한 줄씩 봅니다. 10초마다 자동으로 갱신됩니다.
        </p>
      </div>
      {/* 담당자: "GPS 현황 탭에서 GPS 연결 부분이 맨 위로 오게."
          지금 신호가 들어오는 차(지도·수신 지표)를 먼저 봅니다. 전 호차 한 줄 요약표는
          "누가 빠졌나"를 훑는 용도라 그다음입니다 - 매일 보는 것은 살아 있는 차 쪽입니다. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <PilotMonitorClient
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          initialPilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []}
        />
        <div className="min-h-[220px]">
          <GpsStatusClient />
        </div>
      </div>
    </div>
  );
}
