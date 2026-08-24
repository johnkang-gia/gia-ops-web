import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isWithinTrackingWindow, kstParts } from "@/lib/shuttleTracking";
import { haversineMeters } from "@/lib/shuttleRecommend";

// 기사님 휴대폰이 이 반경(m) 안에 들어오면 그 정류장에 "도착"한 것으로 봅니다. 학교 도착 감지
// (auto-arrive)와 비슷한 값이되, 도심 정류장은 더 촘촘해서 조금 좁게 둡니다.
const STOP_ARRIVE_RADIUS_M = 120;

export const dynamic = "force-dynamic";

// Traccar Client(무료 오픈소스 앱, iOS·안드로이드)가 보내는 위치를 받는 곳입니다.
// 요청: "기사님들은 네비를 핸드폰으로 하시는 경우도 많아서... 백그라운드에서 돌아갈 수 있도록" -
// 웹페이지로는 아이폰에서 백그라운드 위치 전송이 원천적으로 불가능해서, 네이티브 앱인 Traccar
// Client가 우리 서버로 직접 쏘게 했습니다. 기사님은 최초 1회 설정(서버 주소 + 기기 ID) 뒤로는
// 아무 조작도 하지 않으시고, 네비 화면도 전혀 가리지 않습니다.
//
// 프로토콜은 Traccar의 "OsmAnd" 방식으로, 아래처럼 아주 단순한 HTTP 요청입니다.
//   GET /api/shuttle/track?id=abc12345&lat=37.5&lon=127.0&timestamp=1609459200&speed=12&accuracy=8
// 쿼리스트링·폼·JSON 어느 쪽으로 와도 받도록 해뒀습니다(앱 버전에 따라 다를 수 있어서).
//
// 인증은 기기 ID(shuttle_tracker_devices.device_id)가 대신합니다 - 추측이 어려운 임의 문자열이라
// 별도 키 설정 없이도 남이 가짜 위치를 밀어 넣기 어렵습니다. 등록되지 않은 ID는 조용히 버립니다.

function pickNumber(params: URLSearchParams, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = params.get(key);
    if (raw == null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

// timestamp는 초/밀리초/ISO8601/"yyyy-MM-dd HH:mm:ss" 중 아무거나 올 수 있습니다.
function parseTimestamp(raw: string | null): Date {
  if (!raw) return new Date();
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    // 10자리면 초, 13자리면 밀리초입니다.
    return new Date(asNumber > 1e11 ? asNumber : asNumber * 1000);
  }
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

// 이 노선의 정류장 중 현재 위치에서 반경 안에 있는 가장 가까운 정류장을 찾아, 오늘 도착으로
// 기록합니다. unique(service_date, stop_id)라 같은 정류장을 여러 번 지나가도 첫 도착만 남습니다.
async function detectStopArrival(
  supabase: SupabaseClient,
  routeId: string,
  lat: number,
  lng: number,
  recordedAt: Date
) {
  const { data: stops } = await supabase
    .from("shuttle_stops")
    .select("id, gps_lat, gps_lng, lat, lng")
    .eq("route_id", routeId);
  if (!stops || stops.length === 0) return;

  let best: { id: string; dist: number } | null = null;
  for (const s of stops) {
    const sLat = (s.gps_lat as number | null) ?? (s.lat as number | null);
    const sLng = (s.gps_lng as number | null) ?? (s.lng as number | null);
    if (sLat == null || sLng == null) continue;
    const dist = haversineMeters(lat, lng, sLat, sLng);
    if (!best || dist < best.dist) best = { id: s.id as string, dist };
  }
  if (!best || best.dist > STOP_ARRIVE_RADIUS_M) return;

  const serviceDate = kstParts(recordedAt).iso;
  // 중복은 유니크 인덱스(23505)로 조용히 막힙니다 - 이미 기록된 정상 상황입니다.
  await supabase.from("shuttle_stop_arrivals").insert({
    service_date: serviceDate,
    route_id: routeId,
    stop_id: best.id,
    distance_m: Math.round(best.dist),
    arrived_at: recordedAt.toISOString(),
  });
}

async function handle(params: URLSearchParams) {
  const deviceId = (params.get("id") ?? params.get("deviceid") ?? "").trim();
  if (!deviceId) return new NextResponse("missing id", { status: 400 });

  let lat = pickNumber(params, "lat", "latitude");
  let lng = pickNumber(params, "lon", "lng", "longitude");
  // location=위도,경도 형태로 오는 경우도 프로토콜상 허용됩니다.
  const location = params.get("location");
  if ((lat == null || lng == null) && location?.includes(",")) {
    const [rawLat, rawLng] = location.split(",");
    lat = Number(rawLat);
    lng = Number(rawLng);
  }
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    // 좌표 없이 상태만 보내는 요청(하트비트)도 있어서 에러로 취급하지 않습니다.
    return new NextResponse("OK", { status: 200 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return new NextResponse("server not configured", { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: device } = await supabase
    .from("shuttle_tracker_devices")
    .select("id, route_id, enabled")
    .eq("device_id", deviceId)
    .maybeSingle();

  // 등록되지 않았거나 꺼둔 기기는 조용히 무시합니다. 200을 돌려줘야 앱이 "전송 실패"로 보고
  // 계속 재시도하며 배터리를 쓰지 않습니다.
  if (!device || !device.enabled) return new NextResponse("OK", { status: 200 });

  const recordedAt = parseTimestamp(params.get("timestamp"));

  // 하원 운행 시간대 밖의 위치는 저장하지 않습니다(기사님 개인 휴대폰이라 필요한 시간만 수집).
  if (!isWithinTrackingWindow(recordedAt)) {
    await supabase.from("shuttle_tracker_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
    return new NextResponse("OK", { status: 200 });
  }

  const accuracy = pickNumber(params, "accuracy");
  // OsmAnd 프로토콜의 speed 기본 단위는 노트(knot)입니다 - km/h로 바꿔서 저장합니다.
  const speedKnots = pickNumber(params, "speed");
  const speedKmh = speedKnots == null ? null : speedKnots * 1.852;

  await supabase.from("shuttle_pilot_pings").insert({
    route_id: device.route_id,
    lat,
    lng,
    accuracy,
    speed: speedKmh,
    source: "traccar",
    recorded_at: recordedAt.toISOString(),
  });
  await supabase.from("shuttle_tracker_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  // ── 정류장 도착 감지 ─────────────────────────────────────────────────────────
  // 요청: "정류장에 도착했다면 어디정류장에 도착했는지 체크되게". 이 노선의 정류장 좌표 중
  // 지금 위치와 가장 가까운 것이 반경 안이면, 오늘 그 정류장 도착으로 한 줄 남깁니다(하루 한 번).
  // 좌표는 GPS 학습(gps_lat/lng)이 우선이고, 없으면 지오코딩 좌표(lat/lng)를 씁니다. 좌표가
  // 아직 없는 정류장은 건너뜁니다(며칠 운행하면 학습으로 채워집니다).
  await detectStopArrival(supabase, device.route_id as string, lat, lng, recordedAt);

  return new NextResponse("OK", { status: 200 });
}

export async function GET(req: Request) {
  return handle(new URL(req.url).searchParams);
}

export async function POST(req: Request) {
  const merged = new URLSearchParams(new URL(req.url).searchParams);
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body && typeof body === "object") {
        for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
          if (value != null) merged.set(key, String(value));
        }
      }
    } else {
      const text = await req.text();
      if (text) for (const [key, value] of new URLSearchParams(text)) merged.set(key, value);
    }
  } catch {
    // 본문 파싱 실패는 무시하고 쿼리스트링만으로 처리합니다.
  }
  return handle(merged);
}
