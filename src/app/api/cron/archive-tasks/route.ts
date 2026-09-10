import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";
import { PICKUP_ORIGIN } from "@/lib/pickupTask";

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

    // ── 픽업 업무는 보관하지 않고 내립니다 ────────────────────────────────
    //
    // 픽업은 하루 수십 건이고, 그 사실은 픽업 인박스(pickup_requests)와 하원 체크표에
    // 이미 남습니다. 지난 업무에까지 한 벌 더 쌓이면 그날 사람이 계획해서 한 일이 픽업
    // 사이에 묻힙니다. 화면에서 「픽업 완료」를 누르면 그 자리에서 내려가지만, 드래그로
    // 완료 칸에 옮기는 길도 있어서 여기서 한 번 더 훑습니다.
    //
    // 실제로 지우지는 않습니다(deleted_at, 휴지통 7일) - 잘못 눌렀을 때 되돌릴 자리가
    // 없으면 지운 것이 곧 사라진 것이 됩니다.
    const now = new Date().toISOString();
    const { data: droppedPickups, error: dropErr } = await supabase
      .from("tasks")
      .update({ deleted_at: now })
      .eq("status", "완료")
      .eq("origin", PICKUP_ORIGIN)
      .is("archived_at", null)
      .is("deleted_at", null)
      .select("id");
    if (dropErr) throw dropErr;

    const { data: archived, error } = await supabase
      .from("tasks")
      .update({ archived_at: now, term_id: currentTermId })
      .eq("status", "완료")
      .is("archived_at", null)
      // 방금 내린 픽업은 여기 안 들어옵니다. 조건을 안 걸면 같은 줄이 「지운 것」이면서
      // 동시에 「보관된 것」이 되어, 어느 화면에 떠야 맞는지 아무도 답할 수 없습니다.
      .is("deleted_at", null)
      .select("id");
    if (error) throw error;

    await touchHeartbeat(supabase, "cron:archive-tasks");
    return NextResponse.json({
      ok: true,
      archivedCount: archived?.length ?? 0,
      droppedPickupCount: droppedPickups?.length ?? 0,
      termId: currentTermId,
    });
  } catch (err) {
    await logApiError(supabase, "cron:archive-tasks", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
