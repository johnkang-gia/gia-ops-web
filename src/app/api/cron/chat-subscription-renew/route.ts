import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import {
  createSubscription,
  getSubscription,
  loadSubscriptionRow,
  mirroredSpaceIds,
  renewSubscription,
  saveSubscriptionRow,
} from "@/lib/googleChatEvents";
import { touchHeartbeat } from "@/lib/heartbeat";

// 구글챗 푸시 구독을 만들고, 매일 한 번 기한을 되돌립니다.
//
// Workspace 구독은 영구가 아니라 만료됩니다. 구글 문서의 권고는 "만료 임박 알림에 기대지 말고
// 만료 시각을 직접 추적해 갱신하라"입니다. 그래서 조건 따지지 않고 매일 무조건 갱신합니다 -
// 하루치 여유가 늘 남아 있어야, 하루 실패해도 구독이 끊기지 않습니다.
//
// 같은 라우트가 "없으면 만들기"도 합니다. 처음 켤 때도, 구독이 어쩌다 사라졌을 때도 이걸
// 부르면 알아서 복구됩니다(직접 부를 일이 하나로 줄어듭니다).
//
// 외부 스케줄러(cron-job.org)에 하루 한 번(예: 매일 06:30)으로 걸어주세요.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const topic = process.env.GOOGLE_CHAT_PUBSUB_TOPIC;
  if (!topic) {
    return NextResponse.json({ error: "GOOGLE_CHAT_PUBSUB_TOPIC가 설정되지 않았습니다." }, { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const results: { spaceId: string; action: string; expireTime?: string | null; error?: string }[] = [];

  for (const spaceId of mirroredSpaceIds()) {
    try {
      const row = await loadSubscriptionRow(supabase, spaceId);

      // 우리 DB에 이름이 있어도 구글 쪽에서 이미 지워졌을 수 있습니다. 갱신을 시도하기 전에
      // 실제로 살아있는지 먼저 확인해, 없으면 새로 만듭니다.
      const alive = row?.subscription_name ? await getSubscription(supabase, row.subscription_name) : null;

      if (!alive) {
        const created = await createSubscription(supabase, spaceId, topic);
        await saveSubscriptionRow(supabase, spaceId, created);
        results.push({ spaceId, action: "created", expireTime: created.expireTime ?? null });
        continue;
      }

      const renewed = await renewSubscription(supabase, alive.name ?? row!.subscription_name);
      await saveSubscriptionRow(supabase, spaceId, { ...alive, ...renewed });
      results.push({ spaceId, action: "renewed", expireTime: renewed.expireTime ?? alive.expireTime ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logApiError(supabase, "cron:chat-subscription-renew", err);
      results.push({ spaceId, action: "failed", error: message });
    }
  }

  await touchHeartbeat(supabase, "cron:chat-subscription-renew");
  return NextResponse.json({ ok: true, topic, results });
}
