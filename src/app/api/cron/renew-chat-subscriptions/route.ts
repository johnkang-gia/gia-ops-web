import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { createSubscription, renewSubscription, type GoogleChatSourceKey } from "@/lib/googleChat";

const SOURCE_KEYS: GoogleChatSourceKey[] = ["attendance", "teacher_requests"];

// Workspace Events API 구독은 최대 TTL이 있어 그대로 두면 자동으로 끊깁니다(요청: 구글챗
// 미러링이 계속 실시간으로 동작해야 함). 매일 한 번 돌면서, 구독이 아예 없으면 새로 만들고,
// 24시간 안에 만료될 예정이면 연장합니다 - vercel.json에 등록해 자동으로 돌게 합니다.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const results: Record<string, string> = {};

  for (const sourceKey of SOURCE_KEYS) {
    try {
      const { data: existing } = await supabase
        .from("google_chat_subscriptions")
        .select("*")
        .eq("source_key", sourceKey)
        .maybeSingle();

      const needsRenew =
        existing?.expire_time && new Date(existing.expire_time).getTime() - Date.now() < 24 * 60 * 60 * 1000;

      if (!existing) {
        const created = await createSubscription(sourceKey);
        await supabase.from("google_chat_subscriptions").upsert({
          source_key: sourceKey,
          subscription_name: created.name,
          expire_time: created.expireTime,
          updated_at: new Date().toISOString(),
        });
        results[sourceKey] = "created";
      } else if (needsRenew) {
        const renewed = await renewSubscription(existing.subscription_name);
        await supabase
          .from("google_chat_subscriptions")
          .update({ expire_time: renewed.expireTime, updated_at: new Date().toISOString() })
          .eq("source_key", sourceKey);
        results[sourceKey] = "renewed";
      } else {
        results[sourceKey] = "ok";
      }
    } catch (err) {
      results[sourceKey] = "error";
      await logApiError(supabase, `cron:renew-chat-subscriptions:${sourceKey}`, err);
    }
  }

  return NextResponse.json({ ok: true, results });
}
