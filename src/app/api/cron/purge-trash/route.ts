import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";

// 업무 휴지통(요청: "삭제 휴지통 7일 복구")의 뒷단 - 소프트 삭제(deleted_at)된 지 7일이 지난
// 업무는 RLS가 이미 휴지통 화면에서도 안 보이게 숨기지만(schema.sql 섹션 62), 행 자체는
// 여전히 테이블에 남아있습니다. 매일 한 번 이 크론이 실제로 완전히 지워서, "7일간 보관 후
// 영구 삭제"라는 약속을 실제로 지킵니다. task_comments 등은 tasks에 대한
// on delete cascade라 함께 정리됩니다.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: purged, error } = await supabase
      .from("tasks")
      .delete()
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .select("id");
    if (error) throw error;

    // ── 이용 기록 정리 ────────────────────────────────────────────────────
    //
    // 화면 사용량은 **최근 것만 쓸모가 있습니다.** 「지난봄에 이 화면이 몇 번 열렸나」는
    // 아무도 묻지 않는데, 그대로 두면 하루 수천 줄이 해마다 쌓여 정작 이번 달 숫자를
    // 뽑는 조회가 느려집니다. 90일만 둡니다.
    //
    // 숫자로 돌려줍니다 - 「정리했다」만 말하면 실제로 도는지 알 수 없습니다.
    const usageCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: usagePurged, error: usageErr } = await supabase
      .from("usage_events")
      .delete()
      .lt("created_at", usageCutoff)
      .select("id");
    // 이 정리가 실패해도 업무 휴지통 정리까지 되돌리지는 않습니다. 다만 조용히 넘기지
    // 않습니다 - 몇 달째 안 지워지고 있는데 아무도 모르는 쪽이 더 나쁩니다.
    if (usageErr) console.error("[cron:purge-trash] 이용 기록을 정리하지 못했습니다:", usageErr.message);

    await touchHeartbeat(supabase, "cron:purge-trash");
    return NextResponse.json({
      ok: true,
      purgedCount: purged?.length ?? 0,
      usagePurgedCount: usagePurged?.length ?? 0,
      usageProblem: usageErr?.message ?? null,
    });
  } catch (err) {
    await logApiError(supabase, "cron:purge-trash", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
