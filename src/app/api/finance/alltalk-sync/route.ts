import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { readAll } from "@/lib/financeFetch";
import { loadStudentsWithPhones } from "@/lib/students";
import { reconcile, type SyncInvoice, type SyncMark, type SyncStudent } from "@/lib/alltalkSync";
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

type FileRow = { id: string; file_name: string; uploaded_by: string; uploaded_at: string; row_count: number };

async function compute(supabase: SupabaseClient, raws: RawImportRow[]) {
  const { rows: stuRows, error: stuErr } = await loadStudentsWithPhones(supabase);
  if (stuErr) return { error: `명부를 읽지 못했습니다: ${stuErr}` };
  const students: SyncStudent[] = stuRows.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    className: s.class_name,
    department: s.department,
    phones: [s.mother_phone, s.father_phone, s.parent_phone, s.billing_phone]
      .filter(Boolean)
      .map((v) => String(v).replace(/\D/g, ""))
      .filter((v) => v.length >= 9),
  }));

  type InvRow = {
    id: string;
    invoice_no: string;
    student_id: string | null;
    total_amount: number | string;
    status: string;
    billing_month: string | null;
    issue_date: string;
    stream: string | null;
    category: string | null;
    issued_offline: boolean | null;
    exported_at: string | null;
    carried_to_invoice_id: string | null;
    written_off_amount: number | string | null;
  };
  type PayRow = { invoice_id: string | null; amount: number | string; source_key: string | null };
  type MarkRow = { key: string; kind: "link" | "decision"; student_id: string | null; decision: string | null; memo: string | null; updated_by: string; updated_at: string };

  const [invRes, payRes, markRes] = await Promise.all([
    readAll<InvRow>((from, to) =>
      supabase
        .from("invoices")
        .select("id, invoice_no, student_id, total_amount, status, billing_month, issue_date, stream, category, issued_offline, exported_at, carried_to_invoice_id, written_off_amount")
        .eq("status", "발행")
        .order("id")
        .range(from, to),
    ),
    readAll<PayRow>((from, to) => supabase.from("payments").select("invoice_id, amount, source_key").order("id").range(from, to)),
    readAll<MarkRow>((from, to) => supabase.from("alltalk_sync_marks").select("key, kind, student_id, decision, memo, updated_by, updated_at").order("key").range(from, to)),
  ]);
  const err = invRes.error ?? payRes.error ?? markRes.error;
  if (err) return { error: `회계 자료를 읽지 못했습니다: ${err}` };
  if (invRes.truncated || payRes.truncated) return { error: "자료가 너무 많아 끝까지 읽지 못했습니다. 개발 담당에게 알려주세요." };

  const paidBy = new Map<string, number>();
  const paidKeys = new Set<string>();
  for (const p of payRes.rows) {
    if (p.invoice_id) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Math.round(Number(p.amount)));
    if (p.source_key) paidKeys.add(p.source_key.split("#")[0]);
  }
  const invoices: SyncInvoice[] = invRes.rows.map((v) => ({
    id: v.id,
    invoiceNo: v.invoice_no,
    studentId: v.student_id,
    total: Math.round(Number(v.total_amount)),
    paid: paidBy.get(v.id) ?? 0,
    writtenOff: Math.round(Number(v.written_off_amount ?? 0)),
    status: v.status,
    billingMonth: v.billing_month || (v.issue_date ? v.issue_date.slice(0, 7) : null),
    stream: v.stream === "학비" || v.category === "학비" ? "학비" : "학비외",
    offline: !!v.issued_offline,
    exported: !!v.exported_at,
    carried: !!v.carried_to_invoice_id,
  }));
  const marks: SyncMark[] = markRes.rows.map((m) => ({
    key: m.key,
    kind: m.kind,
    studentId: m.student_id,
    decision: m.decision,
    memo: m.memo,
    updatedBy: m.updated_by,
    updatedAt: m.updated_at,
  }));

  const result = reconcile({ raws, students, invoices, paidKeys, marks });
  return {
    ...result,
    // 학생 고르기용. 번호는 담지 않습니다 - 화면에 필요한 것은 이름과 반뿐입니다.
    students: students.map((s) => ({ id: s.id, name: s.name, where: s.className || (s.grade ? `${s.grade}학년` : "") })),
  };
}

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
  const out = await compute(supabase, (data.rows as RawImportRow[]) ?? []);
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

  const out = await compute(supabase, raws);
  if ("error" in out && out.error) return NextResponse.json({ error: out.error }, { status: 500 });
  const { files } = await recentFiles(supabase);
  return NextResponse.json({ files, file: made, ...out });
}
