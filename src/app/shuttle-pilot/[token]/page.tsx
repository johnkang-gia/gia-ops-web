import { createClient } from "@supabase/supabase-js";
import PilotCheckinClient from "@/components/shuttle/PilotCheckinClient";

export const dynamic = "force-dynamic";

// 셔틀 앱 파일럿 검증용 - 기사님·동승선생님이 회사 계정 로그인 없이 이 링크(토큰) 하나로
// 접속합니다. 학부모는 참여하지 않고(강경원님이 대신 모니터링), 정식 앱 전 기술 검증 단계입니다.
export default async function ShuttlePilotPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return <PilotMessage text="서버 설정 오류입니다. 담당자에게 문의해주세요." />;
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: pilot } = await supabase
    .from("shuttle_pilot_routes")
    .select("route_id, enabled")
    .eq("token", token)
    .maybeSingle();

  if (!pilot || !pilot.enabled) {
    return <PilotMessage text="유효하지 않거나 종료된 링크입니다. 담당자에게 문의해주세요." />;
  }

  const { data: route } = await supabase
    .from("shuttle_routes")
    .select("route_no, direction, name")
    .eq("id", pilot.route_id)
    .maybeSingle();

  return (
    <PilotCheckinClient
      token={token}
      routeNo={route?.route_no ?? "?"}
      direction={(route?.direction as "등원" | "하원") ?? "등원"}
      routeName={route?.name ?? ""}
    />
  );
}

function PilotMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontFamily: "sans-serif",
        color: "#334155",
        fontSize: 18,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
}
