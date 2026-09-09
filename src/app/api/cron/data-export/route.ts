import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildExport, stampKst } from "@/lib/dataExport";
import { backupFileName } from "@/lib/backupTables";
import { APP_VERSION } from "@/lib/version";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";

/**
 * 매일 밤, **데이터베이스 밖에** 한 벌을 둡니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 *
 * 앱 안의 백업(`backups` 표)은 같은 데이터베이스에 있습니다. 표가 망가지거나 실수로
 * 통째로 지워지면 백업도 함께 사라집니다. 저장소(Storage)는 Postgres 밖이라 같이 죽지
 * 않습니다.
 *
 * 사람이 매일 눌러 내려받게 하면 **바쁜 날부터 빠집니다.** 그리고 백업이 필요한 날은
 * 대개 바빴던 날 다음입니다.
 *
 * ── 조용히 실패하지 않습니다 ─────────────────────────────────────────
 *
 * 백업 크론의 최악은 «몇 달째 도는 줄 알았는데 첫날부터 실패하고 있던 것»입니다. 실패도,
 * 표가 일부 빠진 것도 `data_export_log` 에 남기고, 연동 상태 화면이 그 기록을 읽습니다.
 *
 * open-api-ok: CRON_SECRET 으로 스스로를 확인하는 창구입니다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 며칠치를 남길지. 매일 한 벌이면 한 달이면 충분하고, 그 이상은 저장소만 먹습니다. */
const KEEP = 30;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await touchHeartbeat(supabase, "cron:data-export");

  try {
    const { payload, rows, failed } = await buildExport(supabase, APP_VERSION);
    const name = backupFileName(stampKst());
    const body = JSON.stringify(payload);
    const bytes = Buffer.byteLength(body, "utf8");

    const { error: upErr } = await supabase.storage
      .from("data-backups")
      .upload(name, body, { contentType: "application/json", upsert: true });

    if (upErr) {
      // 실패를 기록으로 남깁니다. 남기지 않으면 백업이 없다는 사실 자체를 아무도 모릅니다.
      await supabase.from("data_export_log").insert({
        actor_email: "자동",
        kind: "자동저장",
        table_count: Object.keys(payload.counts).length,
        row_count: rows,
        failed_tables: [...failed, `업로드실패:${upErr.message}`],
      });
      await logApiError(supabase, "cron:data-export", new Error(upErr.message));
      return NextResponse.json({ error: `저장소에 올리지 못했습니다: ${upErr.message}` }, { status: 500 });
    }

    await supabase.from("data_export_log").insert({
      actor_email: "자동",
      kind: "자동저장",
      table_count: Object.keys(payload.counts).length,
      row_count: rows,
      failed_tables: failed.length > 0 ? failed : null,
      storage_path: name,
      bytes,
    });

    // 오래된 것 정리. 보관주기가 없으면 저장소가 조용히 불어나고, 불어난 저장소는
    // 결국 요금이 되어 백업을 끄게 만듭니다.
    let removed = 0;
    const { data: files } = await supabase.storage.from("data-backups").list("", { limit: 200, sortBy: { column: "name", order: "desc" } });
    const old = (files ?? []).slice(KEEP).map((f) => f.name);
    if (old.length > 0) {
      const { error: rmErr } = await supabase.storage.from("data-backups").remove(old);
      if (rmErr) await logApiError(supabase, "cron:data-export", new Error(`오래된 백업 정리 실패: ${rmErr.message}`));
      else removed = old.length;
    }

    return NextResponse.json({ ok: true, file: name, rows, bytes, failed, removed });
  } catch (err) {
    await logApiError(supabase, "cron:data-export", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "실패" }, { status: 500 });
  }
}
