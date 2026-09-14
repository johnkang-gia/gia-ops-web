import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import FinanceLive from "@/components/finance/FinanceLive";
import ImportReviewClient from "@/components/finance/ImportReviewClient";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { readAll, readNotice } from "@/lib/financeFetch";
import { studentIdOf, type ReviewRow, type StudentBefore, type MatchKind, type PlanKind } from "@/lib/paymentImport";

export const dynamic = "force-dynamic";

type DbRow = {
  id: string;
  seq: number;
  raw_name: string | null;
  raw_phone: string | null;
  raw_why: string | null;
  item_name: string | null;
  amount: number | string;
  issued_at: string | null;
  paid_at: string | null;
  atp_status: string | null;
  method: string | null;
  match_kind: string;
  match_why: string | null;
  plan: string;
  suggested_student_id: string | null;
  decided_student_id: string | null;
  decision: string;
  applied_at: string | null;
  apply_error: string | null;
};

/**
 * **검수 화면.**
 *
 * 「지금 → 반영 뒤」를 내려면 그 학생의 **지금 값**이 필요합니다. 그래서 여기 나오는
 * 학생들의 청구·수납을 함께 읽습니다 - 이 값이 없으면 화면이 「이렇게 바뀝니다」를 말할
 * 수 없고, 그러면 사람은 무엇이 바뀌는지 모른 채로 승인하게 됩니다.
 */
export default async function ImportReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();

  const { data: batch } = await supabase.from("payment_imports").select("*").eq("id", batchId).maybeSingle();
  if (!batch) notFound();

  const rowRes = await readAll<DbRow>((from, to) =>
    supabase.from("payment_import_rows").select("*").eq("batch_id", batchId).order("seq").range(from, to),
  );

  const rows: ReviewRow[] = rowRes.rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    rawName: r.raw_name ?? "",
    rawPhone: r.raw_phone,
    rawWhy: r.raw_why,
    itemName: r.item_name,
    amount: Math.round(Number(r.amount)),
    issuedAt: r.issued_at,
    paidAt: r.paid_at,
    atpStatus: r.atp_status,
    method: r.method,
    matchKind: r.match_kind as MatchKind,
    matchWhy: r.match_why,
    plan: r.plan as PlanKind,
    suggestedStudentId: r.suggested_student_id,
    decidedStudentId: r.decided_student_id,
    decision: r.decision as ReviewRow["decision"],
    appliedAt: r.applied_at,
    applyError: r.apply_error,
  }));

  const { data: stuRows } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name")
    .eq("is_demo", false)
    .eq("status", "active")
    .order("grade")
    .order("name");
  const students = ((stuRows as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    where: s.class_name || (s.grade ? `${s.grade}학년` : ""),
  }));

  // ── 「지금」 값 ────────────────────────────────────────────────────────
  //
  // 이 묶음이 가리키는 학생들만 읽습니다. 139명 전부를 읽어도 되지만, 가리키지 않는
  // 학생까지 끌어오면 이 화면이 느려지고 느린 화면은 안 쓰이게 됩니다.
  const touched = [...new Set(rows.map((r) => studentIdOf(r)).filter(Boolean))] as string[];
  const beforeByStudent: Record<string, StudentBefore> = {};
  if (touched.length > 0) {
    const invRes = await readAll<{ id: string; student_id: string; total_amount: number | string; status: string; carried_to_invoice_id: string | null }>(
      (from, to) =>
        supabase
          .from("invoices")
          .select("id, student_id, total_amount, status, carried_to_invoice_id")
          .in("student_id", touched)
          .order("id")
          .range(from, to),
    );
    const live = invRes.rows.filter((v) => v.status === "발행" && !v.carried_to_invoice_id);
    const ids = live.map((v) => v.id);
    const payRes =
      ids.length === 0
        ? { rows: [] as { invoice_id: string; amount: number | string }[], truncated: false, error: null }
        : await readAll<{ invoice_id: string; amount: number | string }>((from, to) =>
            supabase.from("payments").select("invoice_id, amount").in("invoice_id", ids).order("invoice_id").range(from, to),
          );
    const paidBy = new Map<string, number>();
    for (const p of payRes.rows) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Number(p.amount));
    for (const v of live) {
      const cur = beforeByStudent[v.student_id] ?? { billed: 0, received: 0, balance: 0 };
      cur.billed += Math.round(Number(v.total_amount));
      cur.received += Math.round(paidBy.get(v.id) ?? 0);
      cur.balance = cur.billed - cur.received;
      beforeByStudent[v.student_id] = cur;
    }
  }

  const notice = readNotice(rowRes);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col p-4 sm:p-6">
      <FinanceLive />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/finance/import" className="text-[12px] font-semibold text-teal-700 underline">
          ← 올리기
        </Link>
        <h1 className="text-lg font-bold">🔎 검수</h1>
      </div>

      {notice && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{notice}</p>
      )}

      <ImportReviewClient
        batchId={batchId}
        fileName={batch.file_name as string}
        status={batch.status as string}
        rows={rows}
        students={students}
        beforeByStudent={beforeByStudent}
      />
    </div>
  );
}
