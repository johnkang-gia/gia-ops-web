import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { kstParts, shouldRunShuttleCron, formatTrackWindows } from "@/lib/shuttleTracking";

// GPS 현황 화면이 쓰는 자료입니다.
//
// 담당자: "링크·기기에 있는 GPS 연결차 보고 있는데, 따로 탭을 만들어서 쭉 볼 수 있게."
//
// 링크·기기 화면은 "기기를 발급하고 설정 링크를 보내는" 곳이라 한 호차씩 카드로 봅니다.
// 운행 중에 보고 싶은 것은 그게 아니라 **전 호차를 한 줄씩 늘어놓은 상태판**입니다 -
// 어느 차가 살아 있고, 어디까지 왔고, 정류장이 찍히고 있는지.

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export type GpsRouteStatus = {
  routeId: string;
  routeNo: string;
  name: string | null;
  driverName: string | null;
  deviceId: string | null;
  enabled: boolean;
  alwaysOn: boolean;
  lastSeenAt: string | null;
  lastHitAt: string | null;
  lastHitReason: string | null;
  /** 오늘 저장된 위치 수. */
  pingsToday: number;
  /** 마지막 위치가 들어온 시각(초 전). */
  lastPingSec: number | null;
  /** 오늘 수신분의 가장 긴 끊김(초). */
  maxGapSec: number | null;
  /** 오늘 찍힌 정류장 도착 수 / 전체 정류장 수. */
  arrivedToday: number;
  stopCount: number;
  /** 좌표 상태별 정류장 수. */
  stopsLearned: number;
  stopsGeocoded: number;
  stopsNoCoords: number;
};

export async function GET() {
  const userDb = await createClient();
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = serviceClient();
  if (!db) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });

  const now = new Date();
  const today = kstParts(now).iso;
  const dayStart = new Date(`${today}T00:00:00+09:00`).toISOString();

  const [{ data: routes }, { data: devices }, { data: stops }, { data: pings }, { data: arrivals }] = await Promise.all([
    db.from("shuttle_routes").select("id, route_no, name, driver_name").eq("term", "정규학기").eq("active", true).eq("direction", "하원"),
    db.from("shuttle_tracker_devices").select("route_id, device_id, enabled, always_on, last_seen_at, last_hit_at, last_hit_reason"),
    db.from("shuttle_stops").select("id, route_id, gps_lat, lat"),
    db.from("shuttle_pilot_pings").select("route_id, recorded_at").gte("recorded_at", dayStart).order("recorded_at", { ascending: true }),
    db.from("shuttle_stop_arrivals").select("route_id").eq("service_date", today),
  ]);

  const deviceByRoute = new Map((devices ?? []).map((d) => [d.route_id as string, d]));

  const pingsByRoute = new Map<string, number[]>();
  for (const p of pings ?? []) {
    const list = pingsByRoute.get(p.route_id as string) ?? [];
    list.push(new Date(p.recorded_at as string).getTime());
    pingsByRoute.set(p.route_id as string, list);
  }

  const arrivalsByRoute = new Map<string, number>();
  for (const a of arrivals ?? []) {
    arrivalsByRoute.set(a.route_id as string, (arrivalsByRoute.get(a.route_id as string) ?? 0) + 1);
  }

  const stopsByRoute = new Map<string, { learned: number; geocoded: number; none: number }>();
  for (const s of stops ?? []) {
    const key = s.route_id as string;
    const acc = stopsByRoute.get(key) ?? { learned: 0, geocoded: 0, none: 0 };
    if (s.gps_lat != null) acc.learned += 1;
    else if (s.lat != null) acc.geocoded += 1;
    else acc.none += 1;
    stopsByRoute.set(key, acc);
  }

  const rows: GpsRouteStatus[] = (routes ?? []).map((r) => {
    const id = r.id as string;
    const d = deviceByRoute.get(id);
    const times = pingsByRoute.get(id) ?? [];
    let maxGap: number | null = null;
    for (let i = 1; i < times.length; i += 1) {
      const gap = (times[i] - times[i - 1]) / 1000;
      if (maxGap == null || gap > maxGap) maxGap = gap;
    }
    const last = times.length > 0 ? times[times.length - 1] : null;
    const st = stopsByRoute.get(id) ?? { learned: 0, geocoded: 0, none: 0 };

    return {
      routeId: id,
      routeNo: (r.route_no as string) ?? "?",
      name: (r.name as string | null) ?? null,
      driverName: (r.driver_name as string | null) ?? null,
      deviceId: (d?.device_id as string | null) ?? null,
      enabled: !!d?.enabled,
      alwaysOn: !!d?.always_on,
      lastSeenAt: (d?.last_seen_at as string | null) ?? null,
      lastHitAt: (d?.last_hit_at as string | null) ?? null,
      lastHitReason: (d?.last_hit_reason as string | null) ?? null,
      pingsToday: times.length,
      lastPingSec: last == null ? null : Math.round((now.getTime() - last) / 1000),
      maxGapSec: maxGap == null ? null : Math.round(maxGap),
      arrivedToday: arrivalsByRoute.get(id) ?? 0,
      stopCount: st.learned + st.geocoded + st.none,
      stopsLearned: st.learned,
      stopsGeocoded: st.geocoded,
      stopsNoCoords: st.none,
    };
  });

  // 호수 오름차순. "4-2"가 "10"보다 앞에 오도록 숫자로 비교합니다.
  rows.sort((a, b) => a.routeNo.localeCompare(b.routeNo, "ko", { numeric: true }));

  return NextResponse.json(
    {
      ok: true,
      today,
      inWindow: shouldRunShuttleCron(now),
      windowLabel: formatTrackWindows(),
      rows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
