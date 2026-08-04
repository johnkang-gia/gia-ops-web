import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { generateEducationNews } from "@/lib/ai/educationNews";
import { logApiError } from "@/lib/logging";

// 관리자가 화면에서 "지금 새로 만들기"를 눌렀을 때 쓰는 수동 생성 라우트입니다. 자동 생성은
// /api/cron/education-news가 월/수 새벽에 대신 호출합니다(같은 생성 로직 재사용).
export async function POST() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 사용할 수 있습니다." }, { status: 403 });

  try {
    const row = await generateEducationNews(supabase);
    return NextResponse.json({ success: true, row });
  } catch (err) {
    await logApiError(supabase, "api:ai:education-news", err, me.email);
    const message = err instanceof Error ? err.message : "교육뉴스를 생성하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
