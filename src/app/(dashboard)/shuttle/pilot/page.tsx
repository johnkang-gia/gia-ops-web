import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { ShuttleRoute, ShuttlePilotRoute } from "@/lib/types";
import PilotMonitorClient from "@/components/shuttle/PilotMonitorClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📍 실시간 위치란?",
    lines: [
      "타 셔틀앱 벤치마킹 제안서의 1단계(실시간 위치 전송, 운행 이벤트)를 정식 도입한 화면입니다. 활성 노선 전체에 자동으로 링크가 생기고, 새 노선을 등록해도 자동으로 포함됩니다.",
      "기사님·동승선생님은 회사 계정 로그인 없이 링크 하나로 접속해 '운행 시작'만 누르면 됩니다. 아래 목록에서 노선별 링크를 복사해 보내드리세요.",
      "체크인 화면 운행 중에는 휴대폰 가속도 센서로 급가속·급감속도 함께 감지해, 노선 카드에 '오늘 안전운행지수'로 보여드립니다(3단계-a).",
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
  const [routesRes, pilotsRes] = await Promise.all([
    supabase.from("shuttle_routes").select("*").eq("active", true).order("direction").order("sort_order"),
    supabase.from("shuttle_pilot_routes").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">📍 셔틀 실시간 위치 - 링크 관리 (1단계)</h1>
        <GuideButton title="실시간 위치 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">전체 활성 노선에 자동으로 적용됩니다. 기사님·동승선생님용 링크를 여기서 관리합니다.</p>
      <div className="flex flex-col gap-4">
        <PilotMonitorClient
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          initialPilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []}
        />
      </div>
    </div>
  );
}
