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

    await touchHeartbeat(supabase, "cron:purge-trash");
    return NextResponse.json({ ok: true, purgedCount: purged?.length ?? 0 });
  } catch (err) {
    await logApiError(supabase, "cron:purge-trash", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
