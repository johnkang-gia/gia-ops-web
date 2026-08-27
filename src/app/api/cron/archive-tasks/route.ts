import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";

// Vercel Cron이 매일 자정 직후(KST)에 호출해서, 그때까지 '완료' 상태인 업무를 업무보드
// 칸반에서 업무기록(보관)으로 넘깁니다. 행 자체는 지우거나 옮기지 않고 archived_at만
// 채우는 방식이라(task_comments 등 연결된 기록이 전혀 끊기지 않음) - 업무보드 목록 쿼리
// (work/page.tsx)는 archived_at is null 조건으로 걸러서 화면에서만 빠지고, 업무기록
// 화면은 반대로 archived_at이 있는 것만 봅니다. 보관되는 시점에 "진행중"인 학기를 함께
// 스냅샷으로 남겨서, 업무기록 화면이 연도>학기별로 묶어 보여줄 수 있게 합니다.
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
    const { data: activeTerms } = await supabase
      .from("terms")
      .select("id, start_date, created_at")
      .eq("status", "진행중")
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1);
    const currentTermId = activeTerms?.[0]?.id ?? null;

    const { data: archived, error } = await supabase
      .from("tasks")
      .update({ archived_at: new Date().toISOString(), term_id: currentTermId })
      .eq("status", "완료")
      .is("archived_at", null)
      .select("id");
    if (error) throw error;

    await touchHeartbeat(supabase, "cron:archive-tasks");
    return NextResponse.json({ ok: true, archivedCount: archived?.length ?? 0, termId: currentTermId });
  } catch (err) {
    await logApiError(supabase, "cron:archive-tasks", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
