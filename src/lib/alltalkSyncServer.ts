import type { SupabaseClient } from "@supabase/supabase-js";
import { readAll } from "@/lib/financeFetch";
import { loadStudentsWithPhones } from "@/lib/students";
import { reconcile, type SyncInvoice, type SyncMark, type SyncStudent } from "@/lib/alltalkSync";
import type { RawImportRow } from "@/lib/paymentImport";

/**
 * 올톡 대조의 재료를 읽어 판정까지. 대조 화면(GET/POST)과 「앱에 넣기」가 **같은 판정**을 써야
 * 합니다 - 넣기가 따로 판정하면 화면에서 본 줄과 실제로 들어가는 줄이 달라질 수 있습니다.
 */
export type AlltalkFileRow = { id: string; file_name: string; uploaded_by: string; uploaded_at: string; row_count: number };

export async function computeAlltalkSync(supabase: SupabaseClient, raws: RawImportRow[]) {
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

