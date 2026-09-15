import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";
import { AUTO_CLOSED_BY, PICKUP_ORIGIN } from "@/lib/pickupTask";

/**
 * **그날 픽업 업무를 오후 6시에 닫습니다.**
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 픽업은 아이를 데려오면 끝나는 일인데, 「픽업 완료」를 누르는 것은 그 다음 동작입니다.
 * 데려오고 나면 다음 아이가 기다리고 있어서, 누르는 것은 자주 빠집니다. 그러면 처리된
 * 일이 흐름판에 그대로 남아 **다음 날 아침에도 빨간 지연 표시로 올라옵니다.**
 *
 * 남은 카드가 실제로 안 한 일인지 누르는 것만 빠진 일인지 구별이 안 되면, 사람은 흐름판
 * 전체를 안 믿게 됩니다. 안 믿는 보드는 없는 보드와 같습니다.
 *
 * ── 왜 오후 6시인가 ─────────────────────────────────────────────────────────
 *
 * 하원은 늦어도 5시 반이면 끝납니다. 6시에 남아 있는 픽업 카드는 「아직 안 한 일」이
 * 아니라 「누르는 것만 빠진 일」입니다.
 *
 * ── 안 한 일까지 닫히지는 않나 ──────────────────────────────────────────────
 *
 * 닫힌다고 **픽업 사실이 사라지지는 않습니다.** 픽업 인박스(`pickup_requests`)와 하원
 * 체크표에 그대로 남고, 자동으로 닫은 것은 `updated_by` 로 사람이 누른 것과 구별됩니다.
 * 흐름판은 «지금 해야 할 일»을 보는 자리이지 그날의 장부가 아닙니다.
 *
 * ── 왜 오늘 것만이 아니라 전부인가 ──────────────────────────────────────────
 *
 * 픽업 업무는 **그날짜 것만** 만들어집니다(`/api/pickup/ensure-tasks` 가 오늘 날짜로만
 * 훑습니다). 그래서 흐름판에 열린 채 남아 있는 픽업은 전부 오늘 또는 그 전 날 것입니다.
 * 날짜를 제목이나 설명에서 되읽어 가르지 않습니다 - 글자를 열쇠로 쓰면 사람이 제목을
 * 고치는 순간 그 줄만 안 닫힙니다(CLAUDE.md §2-4).
 */

// open-api-ok: 크론은 세션이 없습니다. `CRON_SECRET` 으로 스스로 확인합니다.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const now = new Date().toISOString();
    const { data: closed, error } = await supabase
      .from("tasks")
      .update({
        status: "완료",
        completed_at: now,
        // 사람이 누를 때(`pickupDone`)와 똑같이 보드에서 내립니다. 「완료」 칸에만 옮겨
        // 두면 픽업 수십 건이 그 칸을 채워, 사람이 계획해서 끝낸 일이 묻힙니다.
        deleted_at: now,
        // 사람이 누른 것과 구별되는 자국. 없으면 「아무도 안 했는데 완료로 되어 있다」와
        // 「해 놓고 안 눌렀다」가 똑같이 보입니다.
        updated_by: AUTO_CLOSED_BY,
      })
      .eq("origin", PICKUP_ORIGIN)
      .neq("status", "완료")
      .is("archived_at", null)
      .is("deleted_at", null)
      .select("id");
    if (error) throw error;

    await touchHeartbeat(supabase, "cron:pickup-close");
    return NextResponse.json({ ok: true, closedCount: closed?.length ?? 0 });
  } catch (err) {
    await logApiError(supabase, "cron:pickup-close", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
