import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 학부모 테스트 조회 화면(로그인 없음)이 폴링으로 부르는 읽기 전용 API입니다. 회사 계정 세션이
// 없으므로 shuttle_parent_links.token(추측 불가능한 uuid)만으로 어느 학생인지 확인하고, service
// role 키로 조회합니다. 아직 실제 학부모에게 배포하지 않는 테스트 기능이라(요청: "학부모는
// 실질적으로 연결하지는 말고 기능만 구현"), 도착예정시각·알림 계산은 넣지 않고 현재 위치만
// 돌려줍니다.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link, error: linkError } = await supabase
    .from("shuttle_parent_links")
    .select("student_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const { data: student } = await supabase
    .from("wr_students")
    .select("name, name_en")
    .eq("id", link.student_id)
    .maybeSingle();

  const { data: assignments } = await supabase
    .from("shuttle_assignments")
    .select("id, stop_id")
    .eq("student_id", link.student_id);

  const stopIds = [...new Set((assignments ?? []).map((a) => a.stop_id))];
  if (stopIds.length === 0) {
    return NextResponse.json({ studentName: student?.name ?? "학생", directions: [] });
  }

  const { data: stops } = await supabase.from("shuttle_stops").select("id, route_id, stop_time, address").in("id", stopIds);
  const routeIds = [...new Set((stops ?? []).map((s) => s.route_id))];
  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, direction, route_no, name, depart_time")
    .in("id", routeIds.length > 0 ? routeIds : ["00000000-0000-0000-0000-000000000000"]);

  const today = new Date().toISOString().slice(0, 10);
  const directions = await Promise.all(
    (routes ?? [])
      // 같은 방향(등원/하원)에 배정이 여러 건이면 첫 번째 것만 보여줍니다(테스트 화면이라 단순화).
      .filter((r, i, arr) => arr.findIndex((x) => x.direction === r.direction) === i)
      .map(async (route) => {
        const stop = (stops ?? []).find((s) => s.route_id === route.id);
        const assignment = (assignments ?? []).find((a) => a.stop_id === stop?.id);
        const [pingRes, eventsRes, boardingRes] = await Promise.all([
          supabase.from("shuttle_pilot_pings").select("lat, lng, accuracy, recorded_at").eq("route_id", route.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
          supabase.from("shuttle_run_events").select("event, created_at").eq("route_id", route.id).eq("service_date", today).order("created_at", { ascending: true }),
          assignment
            ? supabase.from("shuttle_boardings").select("status, alighted_at").eq("service_date", today).eq("assignment_id", assignment.id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const events = eventsRes.data ?? [];
        const startEvent = events.find((e) => e.event === "출발");
        const endEvent = [...events].reverse().find((e) => e.event === "도착");
        return {
          direction: route.direction,
          routeNo: route.route_no,
          routeName: route.name,
          departTime: route.depart_time,
          stopTime: stop?.stop_time ?? null,
          stopAddress: stop?.address ?? null,
          lastPing: pingRes.data ?? null,
          running: !!startEvent && !endEvent,
          completed: !!startEvent && !!endEvent,
          boardingStatus: boardingRes.data?.status ?? "예정",
          alighted: !!boardingRes.data?.alighted_at,
        };
      })
  );

  return NextResponse.json({ studentName: student?.name ?? "학생", studentNameEn: student?.name_en ?? null, directions });
}
