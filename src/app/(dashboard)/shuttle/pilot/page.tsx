import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { ShuttleRoute, ShuttlePilotRoute, ShuttleParentLink } from "@/lib/types";
import PilotMonitorClient from "@/components/shuttle/PilotMonitorClient";
import ParentLinkManager from "@/components/shuttle/ParentLinkManager";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📍 실시간 위치란?",
    lines: [
      "타 셔틀앱 벤치마킹 제안서의 1단계(실시간 위치 전송, 운행 이벤트)를 정식 도입한 화면입니다. 활성 노선 전체에 자동으로 링크가 생기고, 새 노선을 등록해도 자동으로 포함됩니다.",
      "기사님·동승선생님은 회사 계정 로그인 없이 링크 하나로 접속해 '운행 시작'만 누르면 됩니다. 아래 목록에서 노선별 링크를 복사해 보내드리세요.",
      "학부모 화면은 아직 실제 배포 전 테스트 단계입니다 - 아래 '학부모 테스트 링크'에서 학생을 검색해 직접 확인해볼 수 있습니다. 실시간 위치·탑승/하차 체크·도착예정시각·자동 알림(푸시)까지 모두 반영되어 있습니다.",
      "체크인 화면 운행 중에는 휴대폰 가속도 센서로 급가속·급감속도 함께 감지해, 노선 카드에 '오늘 안전운행지수'로 보여드립니다(3단계-a).",
      "노선 카드의 '오늘 운행일지' 버튼을 누르면 그날의 출발·도착·소요시간·탑승현황·안전운행지수를 정리한 PDF가 자동으로 만들어집니다(3단계-b).",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function ShuttlePilotPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/shuttle");

  const supabase = await createClient();
  const [routesRes, pilotsRes, studentsRes, parentLinksRes] = await Promise.all([
    supabase.from("shuttle_routes").select("*").eq("active", true).order("direction").order("sort_order"),
    supabase.from("shuttle_pilot_routes").select("*").order("created_at", { ascending: false }),
    supabase.from("wr_students").select("id, name, name_en").eq("status", "active").order("name"),
    supabase.from("shuttle_parent_links").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">📍 셔틀 실시간 위치 (1단계)</h1>
        <GuideButton title="실시간 위치 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        전체 활성 노선에 자동으로 적용됩니다. 학부모 화면은 아직 실제 배포 전 테스트 단계입니다.
      </p>
      <div className="flex flex-col gap-4">
        <ParentLinkManager
          students={(studentsRes.data as { id: string; name: string; name_en: string | null }[] | null) ?? []}
          initialLinks={(parentLinksRes.data as ShuttleParentLink[] | null) ?? []}
        />
        <PilotMonitorClient
          routes={(routesRes.data as ShuttleRoute[] | null) ?? []}
          initialPilots={(pilotsRes.data as ShuttlePilotRoute[] | null) ?? []}
        />
      </div>
    </div>
  );
}
