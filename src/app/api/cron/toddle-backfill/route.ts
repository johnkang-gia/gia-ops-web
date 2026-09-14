import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { touchHeartbeat } from "@/lib/heartbeat";
import { applyPlan, loadPlan } from "@/app/api/toddle/backfill/route";

/**
 * **이어 둔 방으로 지난 연락을 되짚어 채웁니다 — 사람이 안 눌러도.**
 *
 * ── 왜 크론인가 ─────────────────────────────────────────────────────────────
 *
 * 토들 방을 학생에게 이어 두는 이유는 **글을 긁어올 때 방 이름만으로 아이를 확실히
 * 가르기 위해서**입니다. 그런데 그 되짚기가 사람이 눌러야 도는 단추라면, 방을 이어 둔
 * 뜻이 없습니다 - 매번 누군가 기억하고 눌러야 하고, 기억에 맡긴 일은 언젠가 빠집니다.
 *
 * 새로 들어오는 연락은 받는 자리(`pickupIngest` 의 `decideOwner`)가 이미 방 연결을 먼저
 * 씁니다. 이 크론은 **그 전에 들어와 비어 있는 줄**과, 방 연결이 나중에 추가돼 이제야
 * 이을 수 있게 된 줄을 맡습니다.
 *
 * ── 하는 일은 사람이 누를 때와 **똑같습니다** ────────────────────────────────
 *
 * 화면의 단추와 이 크론이 같은 함수(`loadPlan` · `applyPlan`)를 씁니다. 두 곳에 규칙을
 * 적으면 반드시 어긋나고, 어긋난 쪽은 「왜 크론은 다르게 채우지」가 됩니다.
 *
 * 그래서 크론도 **사람이 골라야 하는 줄은 손대지 않습니다** - 형제방인데 본문으로도 안
 * 갈리고 출결·하원에 반영되는 글이 그렇습니다. 그런 줄에 기계가 하나를 찍으면 오는 아이가
 * 셔틀에서 빠집니다.
 */

// open-api-ok: 크론은 세션이 없습니다. `CRON_SECRET` 으로 스스로 확인합니다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const r = await loadPlan(supabase as unknown as Parameters<typeof loadPlan>[0]);
  // 조용히 넘기면 「채울 것이 없었다」와 「못 읽었다」가 구별되지 않습니다(CLAUDE.md 5).
  if ("error" in r) {
    console.error("[toddle-backfill] 계획을 세우지 못했습니다:", r.error);
    return NextResponse.json({ error: r.error }, { status: 500 });
  }

  const out = await applyPlan(supabase as unknown as Parameters<typeof applyPlan>[0], r.plan, "자동(크론)");
  if (out.failed > 0) console.error("[toddle-backfill] 일부 실패:", out.failures);

  await touchHeartbeat(supabase, "cron:toddle-backfill");

  return NextResponse.json({
    ok: true,
    ...out,
    // 사람이 봐야 하는 줄이 몇인지 함께 돌려줍니다. 0이 아니면 그만큼이 화면에 쌓여 있습니다.
    note: out.stillAsk > 0 ? `${out.stillAsk}줄은 형제방 출결 건이라 사람이 골라야 합니다.` : null,
  });
}
