import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { ShuttleRoute, ShuttleStop } from "@/lib/types";

export const dynamic = "force-dynamic";

type KakaoDirectionsResponse = {
  routes: {
    result_code: number;
    result_msg: string;
    summary: { distance: number; duration: number };
    sections: { roads: { vertexes: number[] }[] }[];
  }[];
};

// 노선의 정류장을 순서대로 지나는 "실제 도로" 경로를 카카오모빌리티 다중경유지 길찾기로 계산해
// shuttle_route_paths에 캐시합니다. REST API 키가 서버 비밀값이라 이 라우트를 거쳐야 하고,
// 노선 구성이 안 바뀌는 한 다시 계산할 필요가 없어 결과를 저장해두고 재사용합니다.
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) return NextResponse.json({ error: "서버에 KAKAO_REST_API_KEY가 설정되어 있지 않습니다." }, { status: 500 });

  const body = await req.json().catch(() => null);
  const routeId = body?.routeId as string | undefined;
  const giaLat = body?.giaLat as number | undefined;
  const giaLng = body?.giaLng as number | undefined;
  if (!routeId || giaLat == null || giaLng == null) {
    return NextResponse.json({ error: "routeId, giaLat, giaLng가 필요합니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const [{ data: routeData }, { data: stopsData }] = await Promise.all([
    supabase.from("shuttle_routes").select("*").eq("id", routeId).maybeSingle(),
    supabase.from("shuttle_stops").select("*").eq("route_id", routeId).order("seq"),
  ]);
  const route = routeData as ShuttleRoute | null;
  if (!route) return NextResponse.json({ error: "노선을 찾을 수 없습니다." }, { status: 404 });

  const stopsWithCoord = ((stopsData as ShuttleStop[] | null) ?? []).filter((s) => s.lat != null && s.lng != null);
  if (stopsWithCoord.length === 0) {
    return NextResponse.json({ error: "좌표가 있는 정류장이 없습니다. 노선도 탭을 먼저 열어 좌표를 채워주세요." }, { status: 400 });
  }

  // 등원(집→학교)은 정류장을 순서대로 돈 뒤 GIA에서 끝나고, 하원(학교→집)은 GIA에서 출발해
  // 정류장을 순서대로 돕니다 - 노선 지도에서 GIA 지점을 붙이는 방향과 동일한 규칙입니다.
  const school = { name: "GIA", x: giaLng, y: giaLat };
  const stopPoints = stopsWithCoord.map((s) => ({ name: `정류장${s.seq}`, x: s.lng!, y: s.lat! }));
  const points = route.direction === "등원" ? [...stopPoints, school] : [school, ...stopPoints];

  if (points.length < 2) {
    return NextResponse.json({ error: "경로를 계산하려면 좌표가 있는 지점이 2곳 이상 필요합니다." }, { status: 400 });
  }

  const origin = points[0];
  const destination = points[points.length - 1];
  const waypoints = points.slice(1, -1); // 카카오 다중경유지 길찾기는 최대 30개 경유지까지 지원

  let kakaoRes: Response;
  try {
    kakaoRes = await fetch("https://apis-navi.kakaomobility.com/v1/waypoints/directions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `KakaoAK ${restKey}` },
      body: JSON.stringify({
        origin: { name: origin.name, x: origin.x, y: origin.y },
        destination: { name: destination.name, x: destination.x, y: destination.y },
        waypoints: waypoints.map((p) => ({ name: p.name, x: p.x, y: p.y })),
        priority: "RECOMMEND",
        summary: false,
      }),
    });
  } catch {
    return NextResponse.json({ error: "카카오 길찾기 API 호출에 실패했습니다(네트워크 오류)." }, { status: 502 });
  }

  if (!kakaoRes.ok) {
    const text = await kakaoRes.text().catch(() => "");
    return NextResponse.json({ error: `카카오 길찾기 API 오류(${kakaoRes.status}): ${text.slice(0, 300)}` }, { status: 502 });
  }

  const data = (await kakaoRes.json()) as KakaoDirectionsResponse;
  const result = data.routes?.[0];
  if (!result || result.result_code !== 0) {
    return NextResponse.json({ error: `길찾기 실패: ${result?.result_msg ?? "알 수 없는 오류"}` }, { status: 502 });
  }

  const path: { lat: number; lng: number }[] = [];
  for (const section of result.sections ?? []) {
    for (const road of section.roads ?? []) {
      const v = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        path.push({ lng: v[i], lat: v[i + 1] });
      }
    }
  }

  const { error: upsertError } = await supabase.from("shuttle_route_paths").upsert(
    {
      route_id: routeId,
      path,
      distance_m: result.summary.distance,
      duration_s: result.summary.duration,
      stop_ids: stopsWithCoord.map((s) => s.id),
      computed_at: new Date().toISOString(),
    },
    { onConflict: "route_id" }
  );
  if (upsertError) return NextResponse.json({ error: "계산은 됐지만 저장하지 못했습니다: " + upsertError.message }, { status: 500 });

  return NextResponse.json({
    path,
    distance_m: result.summary.distance,
    duration_s: result.summary.duration,
    stop_ids: stopsWithCoord.map((s) => s.id),
  });
}
