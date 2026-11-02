import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ingestPickup, loadRoster, type IngestInput } from "@/lib/pickupIngest";
import { logApiError } from "@/lib/logging";
import { notifyRefreshFromServer } from "@/lib/opsRefresh";

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

  // ── 토들에 직원 답글이 달린 글 → 「답함」 ─────────────────────────────────
  //
  // 답한 것과 일을 끝낸 것은 다릅니다. 「담당실장님께 전달드리겠습니다」는 답이지만 청구서는 아직
  // 다시 안 나갔습니다. 그래서 답글은 「답함」(replied_*)만 채우고, 「처리 완료」(answered_*)는
  // 일을 끝낸 직원이 앱에서 누릅니다. 예전에는 답글을 AI가 읽어 「해결」이면 처리 완료로 넘겼는데,
  // 그러면 할 일이 남은 문의가 목록에서 사라졌습니다.
  //
  // 새 수집기(2.6.0~)는 글마다 그 뒤에 처음 달린 직원 답글을 보냅니다(messageReplies).
  const rawMsgReplies = Array.isArray(body?.messageReplies) ? body.messageReplies : [];
  let repliedCount = 0;
  for (const r of rawMsgReplies.slice(0, 100)) {
    const ref = typeof r?.sourceRef === "string" ? r.sourceRef : null;
    const at = typeof r?.at === "string" ? r.at : null;
    if (!ref || !at) continue;
    const { data: updated } = await supabase
      .from("pickup_requests")
      .update({ replied_at: at, replied_by: typeof r?.by === "string" ? r.by : null, replied_via: "토들 답글" })
      .eq("source", "토들")
      .eq("source_ref", ref)
      .is("replied_at", null)
      .select("id");
    repliedCount += updated?.length ?? 0;
  }

  // 옛 수집기(~2.5)는 방 단위로 「마지막 직원 답글」만 보냅니다. 그 방에서 답글보다 먼저 온 글을 답함으로 둡니다.
  const rawReplies = Array.isArray(body?.replies) ? body.replies : [];
  for (const r of rawReplies.slice(0, 50)) {
    const chatId = typeof r?.chatId === "string" ? r.chatId : null;
    const at = typeof r?.at === "string" ? r.at : null;
    if (!chatId || !at) continue;
    const { data: updated } = await supabase
      .from("pickup_requests")
      .update({ replied_at: at, replied_by: typeof r?.by === "string" ? r.by : null, replied_via: "토들 답글" })
      .eq("source_chat_id", chatId)
      .is("replied_at", null)
      .lt("received_at", at)
      .select("id");
    repliedCount += updated?.length ?? 0;
  }

  if (rawItems.length === 0) {
    // 답글 소식만 전해오는 경우도 있습니다(새 메시지 없이).
    if (rawReplies.length > 0 || rawMsgReplies.length > 0) {
      if (repliedCount > 0) await notifyRefreshFromServer();
      return NextResponse.json({ ok: true, replied: repliedCount, saved: 0 });
    }
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
        // 토들 원문으로 돌아가는 재료.
        //
        // 수집기는 처음부터 이 둘을 보내고 있었는데 **여기서 옮겨 담지 않아 버려졌습니다.**
        // 저장 함수(ingestPickup)도, DB 칸도, 화면 버튼도 다 준비되어 있었는데 이 한 곳이
        // 비어서 `source_url`·`source_chat_id`가 늘 null이었습니다.
        //
        // 새 칸을 만들 때는 "보내는 쪽 → 받는 쪽 → 저장 → 화면" 네 곳을 다 고쳐야 하는데,
        // 받는 쪽만 빠뜨려도 조용히 아무 일도 일어나지 않습니다 - 오류가 안 나기 때문입니다.
        chatId: typeof raw?.chatId === "string" ? raw.chatId : null,
        sourceUrl: typeof raw?.sourceUrl === "string" ? raw.sourceUrl : null,
        staffReply:
          raw?.staffReply && typeof raw.staffReply.at === "string"
            ? { at: raw.staffReply.at, by: typeof raw.staffReply.by === "string" ? raw.staffReply.by : null }
            : null,
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

    // 열려 있는 업무보드를 곧바로 깨웁니다.
    //
    // 담당자 확인: "업무대시보드에는 뜨는데 정작 업무보드에는 새로고침을 해야 떠. 업무보드가
    // 메인이고 업무대시보드는 뷰어야."
    //
    // 순서가 뒤집혀 있던 이유: 대시보드는 30초마다 스스로 다시 부르는데, 업무보드는 표 구독
    // (postgres_changes)에만 기대고 있었고 pickup_requests가 실시간 발행목록에 없어서 아무
    // 소식도 못 받고 있었습니다. 발행목록은 SQL로 고쳤고, 여기서 방송도 함께 보내
    // 둘 중 하나가 어긋나도 화면이 멈추지 않게 합니다.
    await notifyRefreshFromServer();

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    await logApiError(supabase, "pickup:ingest", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
