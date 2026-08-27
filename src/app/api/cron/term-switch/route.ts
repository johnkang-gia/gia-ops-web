import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";

// Vercel Cron이 매일 자정(KST)에 이 라우트를 호출해서, 학기/캠프의 시작일·종료일을
// 기준으로 "진행중" 상태를 자동으로 갱신합니다(vercel.json의 crons 설정 참고).
// - 오늘이 어떤 학기의 [시작일, 종료일] 범위 안이면 그 학기를 진행중으로 켭니다
//   (여러 개가 겹치면 시작일이 가장 늦은 것을 우선함 - terms 페이지 수동 전환과 동일한 기준).
// - 기존에 진행중이던 다른 학기는 자동으로 종료 처리합니다.
// - 진행중이던 학기의 종료일이 이미 지났는데 다음 학기가 아직 시작 전이면, 그 학기만 종료
//   처리하고 새로 켜는 학기는 없습니다(공백 기간 허용).
//
// 로그인 세션 없이(쿠키 없이) 서버가 스스로 호출하는 라우트라서, RLS를 우회하는
// service_role 키로 별도 Supabase 클라이언트를 만듭니다. 브라우저에는 절대 노출되지 않습니다.
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
  // 이 크론이 실제로 불렸다는 표시(연동 상태 화면에서 봅니다).
  await touchHeartbeat(supabase, "cron:term-switch");

  try {
    // KST(UTC+9) 기준 오늘 날짜(YYYY-MM-DD).
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: terms, error } = await supabase
      .from("terms")
      .select("id, start_date, end_date, status");
    if (error) throw error;

    const rows = terms ?? [];
    const candidates = rows.filter(
      (t) => t.start_date && t.start_date <= todayKst && (!t.end_date || t.end_date >= todayKst)
    );
    candidates.sort((a, b) => (b.start_date as string).localeCompare(a.start_date as string));
    const target = candidates[0] ?? null;

    const toEnd = rows.filter(
      (t) => t.status === "진행중" && (!target || t.id !== target.id)
    );
    if (toEnd.length > 0) {
      await Promise.all(
        toEnd.map((t) => supabase.from("terms").update({ status: "종료" }).eq("id", t.id))
      );
    }
    if (target && target.status !== "진행중") {
      await supabase.from("terms").update({ status: "진행중" }).eq("id", target.id);
    }

    return NextResponse.json({
      ok: true,
      today: todayKst,
      activated: target?.id ?? null,
      ended: toEnd.map((t) => t.id),
    });
  } catch (err) {
    await logApiError(supabase, "cron:term-switch", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
