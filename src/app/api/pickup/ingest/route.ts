import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ingestPickup, loadRoster, type IngestInput } from "@/lib/pickupIngest";
import { logApiError } from "@/lib/logging";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";

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
  const rawItems = Array.isArray(body?.items) ? body.items : body?.items === undefined && body ? [body] : [];

  // ── 이미 답글이 달린 방 ────────────────────────────────────────────────────
  // 요청: "혹시나 다른 직원이 답글을 달았다면 해결된 것으로 체크해줘"
  //
  // 다른 선생님이 벌써 답했는데 인박스에 남아 있으면, 또 답하거나 계속 신경 쓰게 됩니다.
  // 학부모는 같은 얘기를 두 번 듣게 되고요. 그래서 답글이 확인되면 처리됨으로 넘깁니다.
  // 사람이 누른 것과 구분되도록 answered_via에 '답글'로 남깁니다.
  const rawReplies = Array.isArray(body?.replies) ? body.replies : [];
  let repliedCount = 0;
  for (const r of rawReplies.slice(0, 50)) {
    const chatId = typeof r?.chatId === "string" ? r.chatId : null;
    const at = typeof r?.at === "string" ? r.at : null;
    if (!chatId || !at) continue;
    const by = typeof r?.by === "string" ? r.by : null;
    const text = typeof r?.text === "string" ? r.text : "";

    // 이 방에 아직 답 안 한 문의가 있는지 먼저 봅니다(없으면 AI를 부르지 않습니다).
    const { data: open } = await supabase
      .from("pickup_requests")
      .select("id")
      .eq("source_chat_id", chatId)
      .eq("kind", "문의")
      .is("answered_at", null)
      .lt("received_at", at);
    if (!open || open.length === 0) continue;

    // 직원 답글이 "해결"인지 "진행중"인지 판단합니다.
    // 요청: "우리직원이 쓴글이라면 문의가 해결되었는지 안되었는지 표시"
    let resolved = true; // 판단 실패 시엔 해결로 봅니다(예전 동작과 같게 - 답이 달렸으니).
    if (text.trim()) {
      try {
        const out = await callClaudeJson(
          "학교 직원이 학부모 문의에 남긴 답글입니다. 이 답으로 문의가 끝났는지 판단하세요. " +
            "\"확인 후 다시 연락드리겠습니다\", \"알아보겠습니다\", \"잠시만요\"처럼 아직 처리 중이면 resolved=false. " +
            "\"처리했습니다\", \"네 알겠습니다\", \"반영했습니다\", 구체적 답변을 준 경우는 resolved=true. " +
            "반드시 JSON만: {\"resolved\": true 또는 false}",
          `답글: """${text.slice(0, 500)}"""`,
          { model: CLAUDE_MODEL_FAST, maxTokens: 60, route: "reply-status" }
        );
        if ((out as { resolved?: unknown } | null)?.resolved === false) resolved = false;
      } catch {
        // AI 실패 - 예전처럼 해결로 처리합니다(답은 달렸으므로).
      }
    }

    const patch = resolved
      ? { answered_at: at, answered_by: by, answered_via: "답글", replied_by: by, replied_at: at, reply_status: "resolved" }
      // 진행중: 답은 달렸지만 목록에는 남겨 "답변중"으로 보이게 합니다(answered_at은 비워둠).
      : { replied_by: by, replied_at: at, reply_status: "pending" };

    const { data: updated } = await supabase
      .from("pickup_requests")
      .update(patch)
      .eq("source_chat_id", chatId)
      .eq("kind", "문의")
      .is("answered_at", null)
      .lt("received_at", at)
      .select("id");
    repliedCount += updated?.length ?? 0;
  }

  if (rawItems.length === 0) {
    // 답글 소식만 전해오는 경우도 있습니다(새 메시지 없이).
    if (rawReplies.length > 0) return NextResponse.json({ ok: true, replied: repliedCount, saved: 0 });
    return NextResponse.json({ error: "items가 필요합니다." }, { status: 400 });
  }
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
