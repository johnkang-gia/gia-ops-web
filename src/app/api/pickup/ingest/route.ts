import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ingestPickup, loadRoster, type IngestInput } from "@/lib/pickupIngest";
import { logApiError } from "@/lib/logging";

export const dynamic = "force-dynamic";

// 토들 수집기(사무실 PC 크롬 확장)와 전화 텍스트 유입이 픽업 연락을 보내는 곳입니다.
//
// 인증은 공유 비밀키 하나로 합니다(PICKUP_INGEST_SECRET). 수집기는 사람 계정으로 로그인하는
// 프로그램이 아니라 학교 PC에서 도는 도구라, 회사 구글 계정 세션을 갖고 있지 않습니다.
// 키가 없으면 아무 요청도 받지 않습니다 - 픽업은 아이를 누구에게 보내느냐의 문제라, 외부에서
// 가짜 픽업을 밀어 넣을 수 있으면 안 됩니다.
//
// 한 번에 여러 건을 보낼 수 있습니다(수집기가 안 읽은 채널 여러 개를 모아서 보냅니다).

export async function POST(req: Request) {
  const secret = process.env.PICKUP_INGEST_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items : body ? [body] : [];
  if (rawItems.length === 0) return NextResponse.json({ error: "items가 필요합니다." }, { status: 400 });
  // 한 번에 너무 많이 보내면 AI 호출이 몰려 응답이 늦어집니다. 수집기가 나눠 보내도록 제한합니다.
  if (rawItems.length > 30) return NextResponse.json({ error: "한 번에 30건까지 보낼 수 있습니다." }, { status: 400 });

  try {
    const roster = await loadRoster(supabase);
    const results = [];
    for (const raw of rawItems) {
      const item: IngestInput = {
        source: (raw?.source as IngestInput["source"]) ?? "토들",
        sourceRef: typeof raw?.sourceRef === "string" ? raw.sourceRef : null,
        channelLabel: typeof raw?.channelLabel === "string" ? raw.channelLabel : null,
        senderName: typeof raw?.senderName === "string" ? raw.senderName : null,
        text: typeof raw?.text === "string" ? raw.text : "",
        receivedAt: typeof raw?.receivedAt === "string" ? raw.receivedAt : null,
      };
      try {
        results.push(await ingestPickup(supabase, item, roster));
      } catch (err) {
        // 한 건이 실패해도 나머지는 계속 처리합니다 - 한 메시지의 오류로 그날 픽업 전체를
        // 놓치는 일이 없어야 합니다.
        await logApiError(supabase, "pickup:ingest:item", err);
        results.push({ isPickup: false, error: true });
      }
    }

    // 수집기가 살아 있다는 신호를 함께 남깁니다.
    await supabase.from("integration_heartbeats").upsert({
      key: "toddle-collector",
      last_seen_at: new Date().toISOString(),
      status: "ok",
      detail: `${rawItems.length}건 수신`,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    await logApiError(supabase, "pickup:ingest", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
