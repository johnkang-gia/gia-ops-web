import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { haversineMeters } from "@/lib/shuttleRecommend";

// 기사님이 **실제로 다니신 길**.
//
// 담당자: "노선 배차표 지도에서 경로 계산한 것, GPS 데이터를 바탕으로 기사님이 실제
//          가시는 경로로 바꿔줘."
//
// 지금 지도에 그려진 선은 카카오에 "이 정류장들을 순서대로 도는 최단 경로"를 물어본
// 결과입니다. 실제 운행과는 다릅니다 - 기사님은 상습 정체 구간을 피하시고, 좌회전이
// 어려운 교차로를 돌아가시고, 아파트 단지도 들어가는 문이 정해져 있습니다.
// 그 차이는 지도만 봐서는 절대 알 수 없고, 실제로 다닌 자취에만 남아 있습니다.
//
// 그래서 가장 최근 운행일의 GPS 자취를 그대로 돌려줍니다. **계산이 아니라 기록입니다.**

export const dynamic = "force-dynamic";

// 점이 너무 촘촘하면(30m마다) 지도가 무거워집니다. 이 거리 안의 점은 건너뜁니다.
const THIN_M = 25;
// 이 정도 벌어진 구간은 이어 그리지 않습니다(터널·신호 끊김). 없는 길을 그리지 않기 위해서.
const BREAK_M = 800;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const userDb = await createClient();
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const routeId = req.nextUrl.searchParams.get("routeId") ?? "";
  if (!routeId) return NextResponse.json({ error: "routeId가 필요합니다." }, { status: 400 });

  const db = serviceClient();
  if (!db) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });

  // 최근 30일 안에서 **마지막으로 실제 운행한 날**을 찾습니다. 어제가 공휴일이면 그 전날,
  // 방학이면 더 앞날이 나옵니다 - "어제"로 못 박으면 빈 지도가 됩니다.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: latest } = await db
    .from("shuttle_pilot_pings")
    .select("recorded_at")
    .eq("route_id", routeId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest?.recorded_at) {
    return NextResponse.json({ ok: true, path: [], serviceDate: null, reason: "최근 30일 안에 GPS 기록이 없습니다." });
  }

  // 그 시각이 속한 한국 날짜의 하루치.
  const kst = new Date(new Date(latest.recorded_at as string).getTime() + 9 * 60 * 60 * 1000);
  const day = kst.toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00+09:00`).toISOString();
  const dayEnd = new Date(`${day}T23:59:59+09:00`).toISOString();

  const { data: pings } = await db
    .from("shuttle_pilot_pings")
    .select("lat, lng, recorded_at")
    .eq("route_id", routeId)
    .gte("recorded_at", dayStart)
    .lte("recorded_at", dayEnd)
    .order("recorded_at", { ascending: true })
    .limit(5000);

  // 촘촘한 점을 솎고, 크게 벌어진 곳은 선을 끊습니다.
  const segments: { lat: number; lng: number }[][] = [];
  let current: { lat: number; lng: number }[] = [];
  let last: { lat: number; lng: number } | null = null;

  for (const p of pings ?? []) {
    const pt = { lat: p.lat as number, lng: p.lng as number };
    if (!last) {
      current.push(pt);
      last = pt;
      continue;
    }
    const d = haversineMeters(last.lat, last.lng, pt.lat, pt.lng);
    if (d > BREAK_M) {
      if (current.length > 1) segments.push(current);
      current = [pt];
      last = pt;
      continue;
    }
    if (d < THIN_M) continue; // 거의 같은 자리 - 건너뜁니다.
    current.push(pt);
    last = pt;
  }
  if (current.length > 1) segments.push(current);

  const pointCount = segments.reduce((n, s) => n + s.length, 0);

  return NextResponse.json(
    {
      ok: true,
      serviceDate: day,
      segments,
      pointCount,
      reason: pointCount === 0 ? "그날 기록이 너무 적어 경로를 그릴 수 없습니다." : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
