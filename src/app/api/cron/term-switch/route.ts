import { NextRequest, NextResponse } from "next/server";
import { todayKst } from "@/lib/kst";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";
import { saveTermSnapshot } from "@/lib/termSnapshot";

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
    // 오늘(한국 기준). 예전에는 여기서 직접 +9시간을 더해 UTC 문자열을 잘랐습니다.
    const today = todayKst();

    const { data: terms, error } = await supabase
      .from("terms")
      .select("id, start_date, end_date, status");
    if (error) throw error;

    const rows = terms ?? [];
    const candidates = rows.filter(
      (t) => t.start_date && t.start_date <= today && (!t.end_date || t.end_date >= today)
    );
    candidates.sort((a, b) => (b.start_date as string).localeCompare(a.start_date as string));
    const target = candidates[0] ?? null;

    const toEnd = rows.filter(
      (t) => t.status === "진행중" && (!target || t.id !== target.id)
    );
    // 학기를 종료로 넘기기 **전에** 그 학기의 반·담임·과목 세팅을 통째로 떠둡니다.
    //
    // 지금 세팅(wr_classes / wr_subjects)은 한 벌뿐이라, 새 학기 반을 짜는 순간 지난 학기
    // 모습은 아무 데도 남지 않고 사라집니다. "작년 2학기에 3학년이 몇 반이었고 담임이
    // 누구였는지"를 나중에 물어볼 곳이 없어집니다. 넘기기 전이 마지막 기회입니다.
    const snapshots: { termId: string; ok: boolean; error?: string }[] = [];
    for (const t of toEnd) {
      const res = await saveTermSnapshot(supabase, t.id, { source: "자동", takenBy: "cron:term-switch" });
      snapshots.push({ termId: t.id, ok: res.ok, error: res.error });
    }

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
      today,
      activated: target?.id ?? null,
      ended: toEnd.map((t) => t.id),
      snapshots,
    });
  } catch (err) {
    await logApiError(supabase, "cron:term-switch", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
