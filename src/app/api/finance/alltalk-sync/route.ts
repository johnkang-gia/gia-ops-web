import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { computeAlltalkSync, type AlltalkFileRow } from "@/lib/alltalkSyncServer";
import type { RawImportRow } from "@/lib/paymentImport";

export const dynamic = "force-dynamic";

/**
 * **올톡 대조** — 올린 청구서관리목록을 운영앱 회계와 맞춰 봅니다.
 *
 * 여기서는 `invoices` · `payments` 를 **한 줄도 고치지 않습니다.** 파일의 줄을 저장하고(다른
 * 사람이 같은 대조를 열 수 있게) 판정 결과를 돌려줄 뿐입니다. 수납·올톡 표시는 화면이 사람의
 * 확인을 받은 뒤 기존 창구로 넣습니다.
 *
 *   GET  ?file=<id>   그 파일(없으면 가장 최근 파일)로 다시 대조
 *   POST {fileName, rows}  새 파일을 올리고 대조
 */

type FileRow = AlltalkFileRow;

async function guard() {
  const me = await getCurrentAppUser();
  if (!me) return { res: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  if (!hasFinanceAccess(me)) return { res: NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 }) };
  return { me };
}

async function recentFiles(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("alltalk_sync_files")
    .select("id, file_name, uploaded_by, uploaded_at, row_count")
    .order("uploaded_at", { ascending: false })
    .range(0, 9);
  return { files: (data as FileRow[] | null) ?? [], error: error?.message ?? null };
}

export async function GET(req: Request) {
  const g = await guard();
  if (g.res) return g.res;
  const supabase = await createClient();
  const { files, error: fErr } = await recentFiles(supabase);
  if (fErr) return NextResponse.json({ error: `올린 파일 목록을 읽지 못했습니다: ${fErr}` }, { status: 500 });
  const want = new URL(req.url).searchParams.get("file");
  const pick = want ? files.find((f) => f.id === want) ?? { id: want } : files[0];
  if (!pick) return NextResponse.json({ files, file: null, rows: [], summary: null, students: [] });

  const { data, error } = await supabase.from("alltalk_sync_files").select("id, file_name, uploaded_by, uploaded_at, row_count, rows").eq("id", pick.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "그 파일을 찾지 못했습니다." }, { status: 404 });
  const out = await computeAlltalkSync(supabase, (data.rows as RawImportRow[]) ?? []);
  if ("error" in out && out.error) return NextResponse.json({ error: out.error }, { status: 500 });
  const { rows: _raw, ...file } = data as FileRow & { rows: unknown };
  void _raw;
  return NextResponse.json({ files, file, ...out });
}

export async function POST(req: Request) {
  const g = await guard();
  if (g.res) return g.res;
  const me = g.me!;
  const body = (await req.json().catch(() => null)) as { fileName?: string; rows?: RawImportRow[] } | null;
  const raws = (body?.rows ?? []).filter((r) => r && Number.isFinite(Number(r.amount)));
  if (raws.length === 0) return NextResponse.json({ error: "읽을 줄이 없습니다. 첫 시트에 고객명·청구금액 칸이 있는지 확인해주세요." }, { status: 400 });
  const fileName = String(body?.fileName ?? "").trim() || "이름 없는 파일";

  const supabase = await createClient();
  const { data: made, error } = await supabase
    .from("alltalk_sync_files")
    .insert({ file_name: fileName, uploaded_by: me.email, row_count: raws.length, rows: raws })
    .select("id, file_name, uploaded_by, uploaded_at, row_count")
    .single();
  if (error || !made) return NextResponse.json({ error: `파일을 저장하지 못했습니다: ${error?.message ?? ""}` }, { status: 500 });

  const out = await computeAlltalkSync(supabase, raws);
  if ("error" in out && out.error) return NextResponse.json({ error: out.error }, { status: 500 });
  const { files } = await recentFiles(supabase);
  return NextResponse.json({ files, file: made, ...out });
}
