import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";

// 통합관리: 자동 일일 백업(요청: "통합관리를 위해... 방법들을 제안해줘" 답변 중 "자동 일일
// 백업"). 관리자 화면(/admin/backups)의 수동 백업과 같은 create_backup 로직을, 아무도 수동으로
// 누르지 않은 날에도 최소 하루 한 번은 남도록 매일 자동 실행합니다. create_scheduled_backup()은
// 일반 로그인 사용자에게는 실행 권한이 없고(schema.sql 70번 섹션), 이 크론이 쓰는 서비스 역할
// 키로만 호출할 수 있습니다. 오래된 자동 백업은 용량을 위해 30일 지나면 정리합니다(수동으로
// 만든 백업은 라벨이 달라 이 정리 대상에서 제외됩니다).
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
    const { data: backup, error } = await supabase.rpc("create_scheduled_backup").single();
    if (error) throw error;

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: purged } = await supabase
      .from("backups")
      .delete()
      .like("label", "자동 일일 백업%")
      .lt("created_at", cutoff)
      .select("id");

    return NextResponse.json({
      ok: true,
      backupId: (backup as { id: string } | null)?.id ?? null,
      purgedOldCount: purged?.length ?? 0,
    });
  } catch (err) {
    await logApiError(supabase, "cron:daily-backup", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
