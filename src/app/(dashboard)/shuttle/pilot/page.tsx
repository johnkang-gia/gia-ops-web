import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { ShuttleRoute, ShuttlePilotRoute } from "@/lib/types";
import PilotMonitorClient from "@/components/shuttle/PilotMonitorClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🧪 파일럿 검증이란?",
    lines: [
      "정식 앱을 만들기 전에, 실제 노선으로 위치 전송이 무리 없이 되는지 먼저 확인하는 단계입니다. 학부모는 참여하지 않고, 기사님·동승선생님만 링크 하나로 접속합니다(회사 계정 로그인 불필요).",
      "노선을 골라 '파일럿 링크 만들기'를 누르면 그 노선 전용 링크가 생성됩니다. 이 링크를 기사님/동승선생님께 문자로 보내드리세요.",
      "운행이 시작되면 이 화면에 실시간 위치와 검증 지표(수신 성공률, 갱신 간격, 완주 여부)가 표시됩니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function ShuttlePilotPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/shuttle");

  const supabase = await createClient();
  const [routesRes, pilotsRes] = await Promise.all([
    supabase.from("shuttle_routes").select("*").eq("active", true).order("direction").order("sort_order"),
    supabase.from("shuttle_pilot_routes").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🧪 셔틀 앱 파일럿 검증</h1>
        <GuideButton title="파일럿 검증 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        학부모 제외, 기사님·동승선생님만 참여하는 정식 앱 이전 기술 검증입니다. 강경원님이 학부모 역할로 모니터링합니다.
      </p>
      <PilotMonitorClient
        routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
        initialPilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []}
      />
    </div>
  );
}
