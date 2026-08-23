import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 토들 수집기가 "살아 있습니다"를 알리는 곳입니다.
//
// 수집기가 조용히 멈추는 것이 가장 나쁜 실패입니다 - 멈춘 줄 모르면 그날 픽업을 통째로
// 놓칩니다. 토들이 화면·통신 구조를 바꾸거나 로그인 세션이 풀리면 실제로 그렇게 됩니다.
// 그래서 수집기가 1분마다 여기에 신호를 남기고, 하원 시간대에 신호가 끊기면 운영 대시보드가
// 빨간 경고를 띄웁니다. "죽으면 시끄럽게"가 원칙입니다.
//
// 픽업을 만들지 않고 상태만 기록하므로 ingest와 같은 비밀키를 씁니다.
export async function POST(req: Request) {
  const secret = process.env.PICKUP_INGEST_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const body = await req.json().catch(() => null);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  await supabase.from("integration_heartbeats").upsert({
    key: typeof body?.key === "string" ? body.key : "toddle-collector",
    last_seen_at: new Date().toISOString(),
    // 'login_required'를 받으면 담당자가 그 PC에서 재로그인만 하면 된다는 뜻입니다.
    status: typeof body?.status === "string" ? body.status : "ok",
    detail: typeof body?.detail === "string" ? body.detail.slice(0, 300) : null,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
