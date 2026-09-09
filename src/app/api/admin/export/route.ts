import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { buildExport, stampKst } from "@/lib/dataExport";
import { backupFileName } from "@/lib/backupTables";
import { APP_VERSION } from "@/lib/version";

/**
 * **학교가 자기 데이터를 손에 쥐는 자리.**
 *
 * 지금까지 백업은 셋 다 데이터베이스 안이나 Supabase 대시보드 안에 있었습니다. 그러면
 * 데이터베이스가 통째로 잘못되거나 계정을 잃었을 때 백업도 같이 사라집니다. **한 벌은
 * 반드시 밖에 있어야 합니다.**
 *
 * 관리자만 부를 수 있습니다 - 학생 개인정보·연락처·회계가 한 파일에 들어 있습니다.
 * 접속 비밀값(구글챗 토큰)은 담지 않습니다(`BACKUP_SKIP`).
 *
 * open-api-ok: 세션으로 사람을 확인하는 라우트입니다. 토큰으로 스스로를 증명하는
 * 창구가 아니므로 미들웨어 통과 목록에 넣지 않습니다.
 */

export const dynamic = "force-dynamic";
// 표를 전부 읽으므로 기본 시간(10초)으로는 모자랍니다.
export const maxDuration = 60;

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 내려받을 수 있습니다." }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const db = createServiceClient(url, key, { auth: { persistSession: false } });

  const { payload, rows, failed } = await buildExport(db, APP_VERSION);

  // 누가 언제 내려받았는지 남깁니다. 개인정보가 통째로 담긴 파일이라 «누가 가져갔나»는
  // 나중에 반드시 물어보게 됩니다. 기록이 실패해도 파일은 내보냅니다 - 기록 때문에 백업을
  // 못 받는 것이 더 나쁩니다. 대신 실패는 머리글에 실어 화면이 알 수 있게 합니다.
  const { error: logErr } = await db.from("data_export_log").insert({
    actor_email: me.email,
    kind: "내려받기",
    table_count: Object.keys(payload.counts).length,
    row_count: rows,
    failed_tables: failed.length > 0 ? failed : null,
  });

  const body = JSON.stringify(payload, null, 1);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFileName(stampKst())}"`,
      // 못 읽은 표가 있으면 **머리글에 적어** 보냅니다. 화면이 이걸 보고 사람에게 알립니다.
      // 파일만 내려가고 아무 말이 없으면, 표가 빠진 백업을 온전한 것으로 믿게 됩니다.
      "X-Backup-Failed": failed.join(",") || "none",
      "X-Backup-Rows": String(rows),
      "X-Backup-Log": logErr ? `기록실패:${logErr.message}` : "ok",
      "Cache-Control": "no-store",
    },
  });
}
