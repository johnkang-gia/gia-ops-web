import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkAlerts } from "@/lib/integrationHealth";
import { toddleServerConfigured } from "@/lib/toddleServer";

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

  /**
   * 서버 수집(TODDLE_JWT)이 켜져 있으면 크롬 확장의 신호는 **따로** 적습니다.
   *
   * 둘이 같은 칸(toddle-collector)을 쓰자, 토들 탭을 닫은 PC의 확장이 1분마다 「토들 탭이 열려 있지 않습니다」(error)를
   * 적고 서버가 곧바로 ok 로 덮어서, 연동 상태와 경보가 «끊김 → 풀림»을 계속 오갔습니다. 수집 책임은 이제 서버에 있으니
   * 확장 신호는 참고용 칸(toddle-extension)에만 남기고 경보에는 넣지 않습니다.
   */
  const askedKey = typeof body?.key === "string" ? body.key : "toddle-collector";
  const key = askedKey === "toddle-collector" && toddleServerConfigured() ? "toddle-extension" : askedKey;
  const row: Record<string, unknown> = {
    key,
    last_seen_at: new Date().toISOString(),
    // 'login_required'를 받으면 담당자가 그 PC에서 재로그인만 하면 된다는 뜻입니다.
    status: typeof body?.status === "string" ? body.status : "ok",
    detail: typeof body?.detail === "string" ? body.detail.slice(0, 300) : null,
    updated_at: new Date().toISOString(),
  };
  // meta: 수집기가 센 «오늘 토들에 학부모가 쓴 글 수». 화면이 앱에 들어온 수와 견줍니다.
  // 새 수집기만 보내므로, 없으면 지난 값을 덮지 않습니다.
  const meta = body?.meta && typeof body.meta === "object" ? body.meta : null;
  const { error } = await supabase.from("integration_heartbeats").upsert(meta ? { ...row, meta } : row);
  // 칸이 아직 없는 동안(마이그레이션 적용 전)에도 살아 있다는 신호는 남아야 합니다.
  if (error && meta) await supabase.from("integration_heartbeats").upsert(row);

  // 토들 수집기는 1분마다 신호를 보냅니다. 크론 둘이 다 죽어도 이 길로 경보가 올라갑니다.
  await checkAlerts(supabase).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
