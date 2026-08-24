import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { kstParts } from "@/lib/shuttleTracking";

export const dynamic = "force-dynamic";

// 요청: "각 정류장 도착하는 시간 기록해서, 평균을 내줘 (...) 각 차량별로, 어느 정류장에 어느
// 시간에 정차했고, 위치가 어디인지 클릭해서 볼 수 있도록". shuttle_stop_arrivals(GPS로 잡은 정류장
// 도착 기록)를 정류장별로 모아 평균 도착시각·오늘 도착·관측 일수와 지난 기록들을 내려줍니다.
export async function GET() {
  const me = await getCurrentAppUser();
  if (!me || !isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const today = kstParts(new Date()).iso;

  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name, driver_name")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", "정규학기")
    .order("sort_order");
  const routeIds = (routes ?? []).map((r) => r.id);
  if (routeIds.length === 0) return NextResponse.json({ routes: [] });

  const { data: stops } = await supabase
    .from("shuttle_stops")
    .select("id, route_id, seq, address, lat, lng, gps_lat, gps_lng")
    .in("route_id", routeIds)
    .order("seq");

  // 최근 60일치 정류장 도착 기록.
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: arrivals } = await supabase
    .from("shuttle_stop_arrivals")
    .select("stop_id, service_date, arrived_at, distance_m")
    .in("route_id", routeIds)
    .gte("arrived_at", since)
    .order("arrived_at", { ascending: false });

  // 정류장별로 도착 기록을 모읍니다.
  const byStop = new Map<string, { date: string; time: string; minutes: number }[]>();
  for (const a of arrivals ?? []) {
    const p = kstParts(new Date(a.arrived_at as string));
    const minutes = p.hour * 60 + p.minute;
    const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    const list = byStop.get(a.stop_id as string) ?? [];
    list.push({ date: a.service_date as string, time, minutes });
    byStop.set(a.stop_id as string, list);
  }
  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

  const stopsByRoute = new Map<string, typeof stops>();
  for (const s of stops ?? []) {
    const list = stopsByRoute.get(s.route_id as string) ?? [];
    list.push(s);
    stopsByRoute.set(s.route_id as string, list as typeof stops);
  }

  const payload = (routes ?? []).map((r) => {
    const rStops = (stopsByRoute.get(r.id as string) ?? []).slice().sort((a, b) => (a.seq as number) - (b.seq as number));
    const stopOut = rStops.map((s) => {
      const recs = (byStop.get(s.id as string) ?? []).sort((a, b) => (a.date < b.date ? 1 : -1));
      const avgMin = recs.length ? recs.reduce((sum, x) => sum + x.minutes, 0) / recs.length : null;
      const todayRec = recs.find((x) => x.date === today) ?? null;
      const lat = (s.gps_lat as number | null) ?? (s.lat as number | null);
      const lng = (s.gps_lng as number | null) ?? (s.lng as number | null);
      return {
        stopId: s.id as string,
        seq: s.seq as number,
        address: (s.address as string | null) ?? null,
        lat,
        lng,
        hasGpsLearned: s.gps_lat != null,
        avgTime: avgMin != null ? fmt(avgMin) : null,
        count: recs.length,
        todayTime: todayRec?.time ?? null,
        records: recs.slice(0, 30), // 최근 30건(날짜·시각)
      };
    });
    const lastStop = stopOut.length ? stopOut[stopOut.length - 1] : null;
    return {
      routeId: r.id as string,
      routeNo: r.route_no as string,
      name: (r.name as string | null) ?? null,
      driverName: (r.driver_name as string | null) ?? null,
      stops: stopOut,
      // 요청: "마지막 정류장으로 파악되는 지점 도착하는 시간" - 마지막 정류장 평균 도착.
      lastStopAvg: lastStop?.avgTime ?? null,
      lastStopAddress: lastStop?.address ?? null,
    };
  });

  return NextResponse.json({ routes: payload, today });
}
