import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isWithinTrackingWindow, kstParts } from "@/lib/shuttleTracking";
import { haversineMeters } from "@/lib/shuttleRecommend";

// 기사님 휴대폰이 이 반경(m) 안에 들어와야 그 정류장에 "도착"한 것으로 봅니다. 요청: "신호대기랑
// 정류장 정차 헷갈리지 않게 정류장 근처일때만 정류장으로 인식" - 도심 정류장이 촘촘하고 GPS가
// 흔들려도 엉뚱한 정류장을 잡지 않도록 좁게(80m) 둡니다. 이보다 멀면 "정류장 아님(운행/대기)".
// 정류장 도착 반경은 **그 정류장 좌표를 얼마나 믿을 수 있느냐**에 따라 다릅니다.
//
// 담당자: "정류장 반경을 너무 빡빡하게 잡지 말고, 우선 조금이라도 길게 정차한 곳의 데이터를
//          받아서 날짜별로 계속 대조해 점차 줄여나가면 될 것 같아."
//
// 맞는 순서입니다. 좁게 잡으면 **아무것도 안 들어와서 줄여나갈 재료조차 안 생깁니다.**
// 지금 27호 정류장 좌표는 대부분 주소 지오코딩 결과라, 실제로 차가 서는 자리(아파트 후문,
// 상가 앞)와 수십~수백 미터씩 어긋나 있습니다. 그 상태에서 80m를 요구하면 영영 0건입니다.
//
// 그래서 좌표의 출처와 학습 정도에 따라 세 단계로 둡니다. 학습이 쌓이면 저절로 좁아집니다.
const RADIUS_GEOCODED_M = 250; // 주소만 있는 상태 - 넓게 열어 재료부터 모읍니다
const RADIUS_LEARNING_M = 150; // GPS로 배우는 중(며칠 안 됨)
const RADIUS_LEARNED_M = 80; // 여러 날 같은 자리에서 확인됨 - 원래 목표치

// 학습된 좌표를 '믿을 만하다'고 보는 기준. 정류장 학습 크론과 같은 값입니다.
const TRUSTED_DAYS = 3;
const TRUSTED_CONFIDENCE = 0.5;

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
// 돌려주는 값은 "왜 안 찍혔는지"를 사람 말로 적은 한 줄입니다. 기기 진단에 그대로 실립니다.
async function detectStopArrival(
  supabase: SupabaseClient,
  routeId: string,
  lat: number,
  lng: number,
  recordedAt: Date
): Promise<string> {
  const { data: stops } = await supabase
    .from("shuttle_stops")
    .select("id, gps_lat, gps_lng, lat, lng, gps_day_count, gps_confidence")
    .eq("route_id", routeId);
  if (!stops || stops.length === 0) return "정류장 없음";

  // 정류장마다 허용 반경이 다르므로, "가장 가까운 곳"이 아니라 **"자기 반경 안에 들어온 곳 중
  // 가장 가까운 곳"** 을 찾아야 합니다. 학습된 정류장(80m) 옆에 아직 주소뿐인 정류장(250m)이
  // 있을 때, 가까운 쪽만 보고 반경을 적용하면 엉뚱한 판정이 납니다.
  let best: { id: string; dist: number; radius: number; kind: string } | null = null;
  let nearest: number | null = null;
  let withCoords = 0;

  for (const s of stops) {
    const learnedLat = s.gps_lat as number | null;
    const learnedLng = s.gps_lng as number | null;
    const sLat = learnedLat ?? (s.lat as number | null);
    const sLng = learnedLng ?? (s.lng as number | null);
    if (sLat == null || sLng == null) continue;
    withCoords += 1;

    const days = (s.gps_day_count as number | null) ?? 0;
    const conf = (s.gps_confidence as number | null) ?? 0;
    const trusted = learnedLat != null && days >= TRUSTED_DAYS && conf >= TRUSTED_CONFIDENCE;
    const radius = learnedLat == null ? RADIUS_GEOCODED_M : trusted ? RADIUS_LEARNED_M : RADIUS_LEARNING_M;
    const kind = learnedLat == null ? "주소" : trusted ? "학습됨" : "학습중";

    const dist = haversineMeters(lat, lng, sLat, sLng);
    if (nearest == null || dist < nearest) nearest = dist;
    if (dist > radius) continue;
    if (!best || dist < best.dist) best = { id: s.id as string, dist, radius, kind };
  }

  if (withCoords === 0) return "정류장 좌표 없음";
  if (!best) return `가장 가까운 정류장 ${Math.round(nearest ?? 0)}m`;

  const serviceDate = kstParts(recordedAt).iso;
  const { error } = await supabase.from("shuttle_stop_arrivals").insert({
    service_date: serviceDate,
    route_id: routeId,
    stop_id: best.id,
    distance_m: Math.round(best.dist),
    // 어떤 좌표로 어떤 반경에서 잡았는지 남깁니다. 이게 있어야 "반경이 실제로 줄고 있는지"를
    // 날짜별로 확인할 수 있습니다 - 줄이는 것은 눈으로 보면서 해야 합니다.
    matched_by: `${best.kind}/${best.radius}m`,
    arrived_at: recordedAt.toISOString(),
  });
  // 중복(23505)은 이미 기록된 정상 상황입니다. 그 밖의 오류는 **삼키지 않습니다.**
  //
  // 여기서 조용히 넘어가는 바람에 "위치는 들어오는데 정류장만 안 찍힌다"가 되어도
  // 화면에는 아무 단서가 없었습니다. 이유를 기기 행에 남겨, 셔틀 탭의 기기 진단에서
  // 바로 보이게 합니다.
  if (error && error.code !== "23505") return `정류장 저장 실패: ${error.message}`;
  return `정류장 도착(${best.kind} ${Math.round(best.dist)}m)`;
}

async function handle(params: URLSearchParams) {
  const deviceId = (params.get("id") ?? params.get("deviceid") ?? "").trim();
  if (!deviceId) return new NextResponse("missing id", { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return new NextResponse("server not configured", { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: device } = await supabase
    .from("shuttle_tracker_devices")
    .select("id, route_id, enabled, always_on, last_hit_at, last_hit_reason")
    .eq("device_id", deviceId)
    .maybeSingle();

  // 등록되지 않았거나 꺼둔 기기는 조용히 무시합니다. 200을 돌려줘야 앱이 "전송 실패"로 보고
  // 계속 재시도하며 배터리를 쓰지 않습니다. (등록 안 된 기기는 남길 곳이 없어 진단도 못 남깁니다 -
  // 기기관리 화면에 "앱 신호 없음"으로 보이면 기기 ID가 다른지 먼저 확인하시면 됩니다.)
  if (!device || !device.enabled) return new NextResponse("OK", { status: 200 });

  // 진단: 앱이 신호를 보냈다는 사실 자체를 기기에 기록해 둡니다(요청: "앱 로그 가져오게 못하나").
  // reason으로 "저장됨 / 시간대밖 / 좌표없음"을 남겨, 셔틀탭에서 왜 위치가 안 뜨는지 바로 봅니다.
  const nowIso = new Date().toISOString();
  // 신호 도달 기록은 1분에 한 번만 씁니다.
  //
  // 기기가 35대로 늘면 이 한 줄이 그대로 곱해집니다. 30초마다 들어오는 핑마다 기기 행을
  // 업데이트하면, 저장할 위치(핑 insert)와 같은 수만큼 UPDATE가 더 생깁니다 - 정작 이 값은
  // 화면에서 "몇 분 전 신호"를 보여주는 용도라 분 단위면 충분합니다. 마지막 기록이 1분 안이면
  // 건너뛰어, 같은 정보를 얻으면서 쓰기를 절반으로 줄입니다.
  // 상태(reason)가 바뀌는 순간은 진단에 중요하므로 그때는 주기와 상관없이 남깁니다.
  const HIT_THROTTLE_MS = 60_000;
  const lastHitAt = device.last_hit_at ? new Date(device.last_hit_at as string).getTime() : 0;
  const markHit = (reason: string, alsoSeen: boolean) => {
    const reasonChanged = device.last_hit_reason !== reason;
    if (!reasonChanged && Date.now() - lastHitAt < HIT_THROTTLE_MS) return Promise.resolve();
    return supabase
      .from("shuttle_tracker_devices")
      .update({ last_hit_at: nowIso, last_hit_reason: reason, ...(alsoSeen ? { last_seen_at: nowIso } : {}) })
      .eq("id", device.id);
  };

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
    await markHit("no_coords", false);
    return new NextResponse("OK", { status: 200 });
  }

  const recordedAt = parseTimestamp(params.get("timestamp"));

  // 하원 운행 시간대 밖의 위치는 저장하지 않습니다(기사님 개인 휴대폰이라 필요한 시간만 수집).
  // 단, always_on 기기(테스트)는 시간대와 무관하게 항상 기록합니다.
  if (!device.always_on && !isWithinTrackingWindow(recordedAt)) {
    await markHit("out_of_window", true);
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

  // ── 정류장 도착 감지 ─────────────────────────────────────────────────────────
  // 요청: "정류장에 도착했다면 어디정류장에 도착했는지 체크되게". 이 노선의 정류장 좌표 중
  // 지금 위치와 가장 가까운 것이 반경 안이면, 오늘 그 정류장 도착으로 한 줄 남깁니다(하루 한 번).
  // 좌표는 GPS 학습(gps_lat/lng)이 우선이고, 없으면 지오코딩 좌표(lat/lng)를 씁니다. 좌표가
  // 아직 없는 정류장은 건너뜁니다(며칠 운행하면 학습으로 채워집니다).
  const stopNote = await detectStopArrival(supabase, device.route_id as string, lat, lng, recordedAt);

  // 위치 저장 결과와 정류장 판정을 **함께** 남깁니다. 예전에는 "stored"만 남겨서,
  // 위치는 들어오는데 정류장만 안 찍히는 상황을 화면에서 알아볼 방법이 없었습니다.
  await markHit(`stored · ${stopNote}`, true);

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
