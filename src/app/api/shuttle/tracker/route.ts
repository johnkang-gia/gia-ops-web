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
function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return out;
}
const generateDeviceId = () => randomCode(8);

// 설정 링크(/s/{코드})는 문자 한 줄에 들어가야 해서 더 짧게 6자리입니다. 위치를 보내는 열쇠가
// 아니라 안내 화면을 여는 열쇠일 뿐이라, 짧아도 위험이 낮습니다.
const generateSetupCode = () => randomCode(6);

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
      .insert({
        device_id: generateDeviceId(),
        setup_code: generateSetupCode(),
        route_id: routeId,
        label: (body?.label as string | undefined) ?? null,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, device: data });
  }

  // 아직 기기가 없는 하원 노선에 한 번에 발급합니다.
  //
  // 왜 필요한가요? 기사님이 오실 때마다 담당자가 노선을 고르고 발급 버튼을 누르는 일이
  // 반복됩니다(요청: "오시는 분마다 내가 설정해 드리는것도 문제"). 기기 ID는 어차피 노선마다
  // 하나씩 있으면 되는 값이라, 미리 전부 만들어두면 그 단계가 통째로 사라집니다. 그러면 담당자는
  // "링크 보내기"만 하면 되고, 기사님이 오시지 않아도 설정이 진행됩니다.
  if (action === "bulk_create") {
    const routeIds = Array.isArray(body?.routeIds) ? (body.routeIds as string[]) : [];
    if (routeIds.length === 0) return NextResponse.json({ error: "routeIds가 필요합니다." }, { status: 400 });

    // 이미 있는 노선은 건너뜁니다. 한 노선에 기기가 둘이면 어느 쪽이 진짜인지 알 수 없습니다.
    const { data: existing, error: existingError } = await supabase
      .from("shuttle_tracker_devices")
      .select("route_id")
      .in("route_id", routeIds);
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

    const taken = new Set((existing ?? []).map((d) => d.route_id as string));
    const missing = routeIds.filter((id) => !taken.has(id));
    if (missing.length === 0) return NextResponse.json({ ok: true, devices: [], skipped: routeIds.length });

    const { data, error } = await supabase
      .from("shuttle_tracker_devices")
      .insert(missing.map((routeId) => ({ device_id: generateDeviceId(), setup_code: generateSetupCode(), route_id: routeId })))
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, devices: data, skipped: taken.size });
  }

  // 설정 링크가 엉뚱한 곳으로 갔을 때 쓰는 기능입니다. 새 코드를 넣으면 예전 링크는 즉시
  // 열리지 않게 되고, 이미 설정을 마친 휴대폰은 아무 영향을 받지 않습니다(기기 ID는 그대로).
  if (action === "reissue_setup_code") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const setupCode = generateSetupCode();
    const { error } = await supabase
      .from("shuttle_tracker_devices")
      .update({ setup_code: setupCode, setup_opened_at: null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, setupCode });
  }

  if (action === "toggle") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const { error } = await supabase.from("shuttle_tracker_devices").update({ enabled: !!body?.enabled }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // 24시간 테스트 켜기/끄기. 요청: 하원 시간대가 아니어도 지금 바로 위치가 저장되는지 테스트.
  // 켜두면 그 기기는 시간대와 무관하게 위치를 기록합니다(테스트가 끝나면 꺼서 평소대로 돌립니다).
  if (action === "toggle_always_on") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const { error } = await supabase.from("shuttle_tracker_devices").update({ always_on: !!body?.always_on }).eq("id", id);
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
