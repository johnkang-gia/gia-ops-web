import { createClient } from "@supabase/supabase-js";
import PilotCheckinClient, { type BoardingRosterItem } from "@/components/shuttle/PilotCheckinClient";

export const dynamic = "force-dynamic";

// 셔틀 실시간 위치(1단계 정식 기능) - 기사님·동승선생님이 회사 계정 로그인 없이 이 링크(토큰)
// 하나로 접속합니다. 위치 전송에 더해, 오늘 이 노선에 배정된 학생별 탑승·하차 체크리스트도
// 여기서 함께 처리합니다(2단계-a).
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

  // 오늘 이 노선에 배정된 학생 목록을 정류장 순서대로 준비합니다(요일 필터: weekdays에 오늘이
  // 포함된 배정만). weekdays는 1=월...5=금으로 저장되어 있습니다.
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayWeekday = new Date().getDay();

  const { data: stops } = await supabase
    .from("shuttle_stops")
    .select("id, seq, stop_time, address")
    .eq("route_id", pilot.route_id)
    .order("seq");
  const stopIds = (stops ?? []).map((s) => s.id);

  let roster: BoardingRosterItem[] = [];
  if (stopIds.length > 0) {
    const { data: assignments } = await supabase
      .from("shuttle_assignments")
      .select("id, stop_id, student_name_raw, weekdays")
      .in("stop_id", stopIds);
    const relevant = (assignments ?? []).filter((a) => (a.weekdays as number[]).includes(todayWeekday));

    const { data: boardings } = relevant.length
      ? await supabase
          .from("shuttle_boardings")
          .select("assignment_id, status, alighted_at")
          .eq("service_date", todayIso)
          .in("assignment_id", relevant.map((a) => a.id))
      : { data: [] };
    const boardingByAssignment = new Map((boardings ?? []).map((b) => [b.assignment_id, b]));
    const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

    roster = relevant
      .map((a) => {
        const stop = stopById.get(a.stop_id);
        const b = boardingByAssignment.get(a.id);
        return {
          assignmentId: a.id as string,
          studentName: a.student_name_raw as string,
          stopSeq: stop?.seq ?? 0,
          stopTime: stop?.stop_time ?? null,
          status: (b?.status as BoardingRosterItem["status"]) ?? "예정",
          alighted: !!b?.alighted_at,
        };
      })
      .sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));
  }

  return (
    <PilotCheckinClient
      token={token}
      routeNo={route?.route_no ?? "?"}
      direction={(route?.direction as "등원" | "하원") ?? "등원"}
      routeName={route?.name ?? ""}
      initialRoster={roster}
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
