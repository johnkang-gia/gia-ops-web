import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { validateBackupFile, planRestore, applyRestore } from "@/lib/dataRestore";
import { buildExport, stampKst } from "@/lib/dataExport";
import { APP_VERSION } from "@/lib/version";

/**
 * **내려받은 파일로 되돌리기.**
 *
 * 두 번에 나눠 부릅니다.
 *
 *   ① `dryRun: true`  → 무엇이 몇 줄 바뀌는지만 세어 돌려줍니다. 아무것도 안 바뀝니다.
 *   ② `dryRun: false` → 실제로 되돌립니다. **직전에 지금 상태를 저장소에 한 벌 남깁니다.**
 *
 * ── 왜 직전 백업을 강제하나 ──────────────────────────────────────────
 *
 * 되돌리기를 누르는 사람은 이미 사고를 수습하는 중입니다. 그 상태에서 「되돌렸더니 더
 * 나빠졌다」가 되면 손쓸 방법이 없습니다. 되돌린 것을 다시 되돌릴 수 있어야 사람이 누를 수
 * 있고, 누를 수 없는 복구 기능은 없는 것과 같습니다.
 *
 * 직전 백업이 실패하면 **되돌리기를 하지 않습니다.** 안전망 없이 덮어쓰는 것보다, 안 하고
 * 이유를 말하는 편이 낫습니다.
 *
 * open-api-ok: 세션으로 사람을 확인하는 라우트입니다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 되돌릴 수 있습니다." }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const db = createServiceClient(url, key, { auth: { persistSession: false } });

  const body = (await req.json().catch(() => null)) as {
    backup?: unknown;
    tables?: string[];
    dryRun?: boolean;
    wipeMissing?: boolean;
  } | null;
  if (!body?.backup) return NextResponse.json({ error: "백업 파일을 함께 보내주세요." }, { status: 400 });

  const { file, error: badFile } = validateBackupFile(body.backup);
  if (!file) return NextResponse.json({ error: badFile }, { status: 400 });

  // 고른 표만 되돌립니다. 안 고르면 파일에 있는 전부입니다.
  const inFile = Object.keys(file.data);
  const tables = (body.tables && body.tables.length > 0 ? body.tables.filter((t) => inFile.includes(t)) : inFile);
  if (tables.length === 0) return NextResponse.json({ error: "되돌릴 표가 없습니다." }, { status: 400 });

  // ── ① 미리 보기 ──────────────────────────────────────────────────
  if (body.dryRun !== false) {
    const plan = await planRestore(db, file, tables);
    return NextResponse.json({ ok: true, dryRun: true, exportedAt: file.exportedAt, appVersion: file.appVersion, plan });
  }

  // ── ② 되돌리기 직전, 지금 상태를 남깁니다 ────────────────────────
  const safetyName = `되돌리기전-${stampKst()}.json`;
  const snapshot = await buildExport(db, APP_VERSION);
  const { error: snapErr } = await db.storage
    .from("data-backups")
    .upload(safetyName, JSON.stringify(snapshot.payload), { contentType: "application/json", upsert: true });

  if (snapErr) {
    // 안전망 없이 덮어쓰지 않습니다.
    return NextResponse.json(
      { error: `되돌리기 직전 백업에 실패해 중단했습니다: ${snapErr.message}. 안전망 없이 덮어쓸 수는 없습니다.` },
      { status: 500 },
    );
  }
  await db.from("data_export_log").insert({
    actor_email: me.email,
    kind: "자동저장",
    table_count: Object.keys(snapshot.payload.counts).length,
    row_count: snapshot.rows,
    failed_tables: snapshot.failed.length > 0 ? snapshot.failed : null,
    storage_path: safetyName,
  });

  // ── ③ 되돌리기 ───────────────────────────────────────────────────
  const results = await applyRestore(db, file, tables, { wipeMissing: body.wipeMissing === true });
  const failed = results.filter((r) => r.error);
  const written = results.reduce((n, r) => n + r.written, 0);
  const deleted = results.reduce((n, r) => n + r.deleted, 0);

  await db.from("data_restore_log").insert({
    actor_email: me.email,
    backup_exported_at: file.exportedAt,
    tables,
    rows_written: written,
    rows_deleted: deleted,
    failed_tables: failed.length > 0 ? failed.map((f) => `${f.table}: ${f.error}`) : null,
    safety_backup_path: safetyName,
  });

  return NextResponse.json({
    ok: failed.length === 0,
    written,
    deleted,
    safetyBackup: safetyName,
    results,
    // 실패한 표를 숨기지 않습니다. 절반만 들어간 상태를 「완료」로 보여주면, 사람은 다 된 줄
    // 알고 넘어갔다가 며칠 뒤에 그 표만 비어 있는 것을 발견합니다.
    error:
      failed.length > 0
        ? `${failed.length}개 표를 되돌리지 못했습니다: ${failed.map((f) => f.table).join(", ")}. 나머지는 되돌렸습니다.`
        : null,
  });
}
