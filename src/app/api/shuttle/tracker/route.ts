import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";

export const dynamic = "force-dynamic";

// 관리자 화면에서 Traccar 기기를 등록·해제하고, GPS로 학습한 정류장 좌표를 실제 좌표에
// 반영하는 곳입니다. 위치를 받는 쪽(/api/shuttle/track)과 달리 여기는 로그인한 관리자만
// 쓸 수 있습니다.

// 기사님이 손으로 입력하실 값이라 헷갈리는 글자(0/O, 1/l/I)는 빼고 8자리로 만듭니다.
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function generateDeviceId(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return out;
}

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me || !isAdminUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = await createClient();
  const body = await req.json().catch(() => null);
  const action = body?.action as string | undefined;

  if (action === "create") {
    const routeId = body?.routeId as string | undefined;
    if (!routeId) return NextResponse.json({ error: "routeId가 필요합니다." }, { status: 400 });
    const { data, error } = await supabase
      .from("shuttle_tracker_devices")
      .insert({ device_id: generateDeviceId(), route_id: routeId, label: (body?.label as string | undefined) ?? null })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, device: data });
  }

  if (action === "toggle") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const { error } = await supabase.from("shuttle_tracker_devices").update({ enabled: !!body?.enabled }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const { error } = await supabase.from("shuttle_tracker_devices").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // GPS로 학습한 좌표를 정류장의 실제 좌표로 옮깁니다. 되돌릴 수 있도록 학습값은 그대로 두고
  // lat/lng만 갱신합니다.
  if (action === "apply_gps") {
    const stopId = body?.stopId as string | undefined;
    if (!stopId) return NextResponse.json({ error: "stopId가 필요합니다." }, { status: 400 });
    const { data: stop } = await supabase.from("shuttle_stops").select("gps_lat, gps_lng").eq("id", stopId).maybeSingle();
    if (!stop?.gps_lat || !stop?.gps_lng) return NextResponse.json({ error: "학습된 좌표가 없습니다." }, { status: 400 });
    const { error } = await supabase
      .from("shuttle_stops")
      .update({ lat: stop.gps_lat, lng: stop.gps_lng, geocoded_at: new Date().toISOString() })
      .eq("id", stopId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // 어느 정류장인지 자동으로 연결되지 않은 정차 지점을, 담당자가 직접 정류장에 붙여줍니다.
  if (action === "assign_observation") {
    const observationId = body?.observationId as number | undefined;
    const stopId = (body?.stopId as string | undefined) ?? null;
    if (!observationId) return NextResponse.json({ error: "observationId가 필요합니다." }, { status: 400 });
    const { error } = await supabase
      .from("shuttle_stop_observations")
      .update({ matched_stop_id: stopId })
      .eq("id", observationId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "알 수 없는 action입니다." }, { status: 400 });
}
