import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 파일럿 체크인 페이지(로그인 없음)가 위치를 보내는 곳입니다. 회사 계정 세션이 없으므로,
// route_id 대신 shuttle_pilot_routes.token(추측 불가능한 uuid)만으로 어느 노선인지 확인하고,
// service role 키로 씁니다(RLS 우회 - 이 라우트 자체가 유일한 검증 수단입니다).
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const token = body?.token as string | undefined;
  const lat = body?.lat as number | undefined;
  const lng = body?.lng as number | undefined;
  const accuracy = body?.accuracy as number | undefined;
  if (!token || typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "token, lat, lng가 필요합니다." }, { status: 400 });
  }
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) {
    // 한국 밖 좌표는 GPS 오류일 가능성이 높아 그냥 버립니다(검증 지표를 왜곡하지 않도록).
    return NextResponse.json({ error: "좌표 범위를 벗어났습니다." }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: pilot, error: pilotError } = await supabase
    .from("shuttle_pilot_routes")
    .select("route_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (pilotError) return NextResponse.json({ error: pilotError.message }, { status: 500 });
  if (!pilot || !pilot.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const { error: insertError } = await supabase.from("shuttle_pilot_pings").insert({
    route_id: pilot.route_id,
    lat,
    lng,
    accuracy: accuracy ?? null,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
