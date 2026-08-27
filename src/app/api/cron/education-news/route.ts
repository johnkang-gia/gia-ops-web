import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateEducationNews } from "@/lib/ai/educationNews";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";

// Vercel Cron이 매주 월/수 아침(KST)에 이 라우트를 호출해 교육뉴스를 자동으로 새로 만듭니다
// (vercel.json의 crons 설정 참고 - UTC 기준 일/화 22:00 = KST 월/수 07:00).
// term-switch cron과 동일하게, 로그인 세션 없이 서버가 스스로 호출하므로 RLS를 우회하는
// service_role 키로 별도 클라이언트를 만듭니다(관리자 전용 테이블이라 익명 키로는 쓸 수 없음).
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
    const row = await generateEducationNews(supabase);
    await touchHeartbeat(supabase, "cron:education-news");
    return NextResponse.json({ ok: true, case_id: row.case_id });
  } catch (err) {
    await logApiError(supabase, "cron:education-news", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
