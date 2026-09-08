import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import type { SavedAttachment } from "@/lib/googleChat";

/**
 * 구글챗에서 가져온 사진·파일을 **30일 뒤에 지웁니다.**
 *
 * 이 사진들은 그때그때 보고 대응하는 용도지 모아둘 자료가 아닙니다 - 다친 자리 사진, 알림장
 * 사진, 준비물 사진. 남겨두면 아이 얼굴이 든 파일이 우리 저장소에 계속 쌓이고, 쌓인 것은
 * 아무도 지우지 않습니다.
 *
 * 파일만 지우고 **줄은 남깁니다.** 「사진이 있었는데 보관 기간이 지나 지웠습니다」가 화면에
 * 보여야 합니다 - 통째로 지우면 그날 그 이야기가 아예 없었던 것처럼 보입니다.
 */
export const dynamic = "force-dynamic";

const KEEP_DAYS = 30;
const BUCKET = "chat-attachments";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("google_chat_mirror_messages")
    .select("id, attachments")
    .not("attachments", "is", null)
    .lt("created_at_google", cutoff)
    .limit(500);
  if (error) {
    await logApiError(supabase, "cron:purge-chat-attachments", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as { id: string; attachments: SavedAttachment[] | null }[] | null) ?? [];
  const paths = rows.flatMap((r) => (r.attachments ?? []).map((a) => a.path).filter((p): p is string => !!p));
  if (paths.length === 0) return NextResponse.json({ ok: true, removed: 0 });

  const { error: rmError } = await supabase.storage.from(BUCKET).remove(paths);
  if (rmError) {
    await logApiError(supabase, "cron:purge-chat-attachments:storage", rmError);
    return NextResponse.json({ error: rmError.message }, { status: 500 });
  }

  for (const r of rows) {
    const next = (r.attachments ?? []).map((a) =>
      a.path ? { ...a, path: null, why: `보관 기간(${KEEP_DAYS}일)이 지나 지웠습니다` } : a,
    );
    const { error: upError } = await supabase.from("google_chat_mirror_messages").update({ attachments: next }).eq("id", r.id);
    // 파일은 지웠는데 표시를 못 바꾸면 화면이 없는 파일을 계속 열려고 합니다. 조용히 넘기지 않습니다.
    if (upError) await logApiError(supabase, "cron:purge-chat-attachments:mark", upError);
  }

  return NextResponse.json({ ok: true, removed: paths.length, messages: rows.length });
}
