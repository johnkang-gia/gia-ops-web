import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { buildImportPlan, invoiceNosOf, summarizePlan, type AppInvoice, type RawImportRow, type StudentLite } from "@/lib/paymentImport";
import { readAll } from "@/lib/financeFetch";
import { loadStudentsWithPhones } from "@/lib/students";

export const dynamic = "force-dynamic";

/**
 * **올린 파일을 검수 대기로 세웁니다.**
 *
 * 여기서는 `invoices` · `payments` 를 **한 줄도 건드리지 않습니다.** 판정만 해서
 * `payment_import_rows` 에 담고, 사람이 승인한 줄만 `/apply` 가 내보냅니다.
 *
 * 87% 가 맞는다고 바로 반영하면, 틀린 13% 는 **남의 아이에게 남의 돈이 붙은 채로** 화면에
 * «정상»으로 보입니다. 돈에서 이건 되돌리기가 가장 어려운 종류의 사고입니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { fileName?: string; rows?: RawImportRow[] } | null;
  const raws = (body?.rows ?? []).filter((r) => r && Number.isFinite(Number(r.amount)));
  const fileName = String(body?.fileName ?? "").trim() || "이름 없는 파일";
  if (raws.length === 0) {
    return NextResponse.json({ error: "읽을 줄이 없습니다. 첫 시트에 금액 칸이 있는지 확인해주세요." }, { status: 400 });
  }

  const supabase = await createClient();

  // ── 명부 ──────────────────────────────────────────────────────────────
  // 번호는 **넷 다** 봅니다. 결제번호를 따로 정한 집이 있고, 옛 줄은 보호자 칸만 차 있습니다.
  const { rows: stuRows, error: stuErr } = await loadStudentsWithPhones(supabase);
  if (stuErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${stuErr}` }, { status: 500 });

  const students: StudentLite[] = stuRows.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    className: s.class_name,
    phones: [s.mother_phone, s.father_phone, s.parent_phone, s.billing_phone]
      .filter(Boolean)
      .map((v) => String(v).replace(/\D/g, ""))
      .filter((v) => v.length >= 9),
  }));

  // ── 이미 들어온 열쇠 ──────────────────────────────────────────────────
  //
  // 같은 파일을 두 번 올려도 같은 돈이 두 번 들어가지 않게 합니다. 청구서와 입금 **양쪽**을
  // 봅니다 - 한쪽만 보면 청구서만 두 장이 되고, 그러면 그 학생의 미납이 두 배로 보입니다.
  const [invKeys, payKeys] = await Promise.all([
    readAll<{ import_source_key: string | null }>((from, to) =>
      supabase.from("invoices").select("import_source_key").not("import_source_key", "is", null).order("id").range(from, to),
    ),
    readAll<{ source_key: string | null }>((from, to) =>
      supabase.from("payments").select("source_key").not("source_key", "is", null).order("id").range(from, to),
    ),
  ]);
  if (invKeys.error || payKeys.error) {
    return NextResponse.json({ error: `이미 들어온 줄을 확인하지 못했습니다: ${invKeys.error ?? payKeys.error}` }, { status: 500 });
  }
  const existing = new Set<string>();
  for (const r of invKeys.rows) if (r.import_source_key) existing.add(r.import_source_key);
  // 한 줄을 형제 청구서 여러 장에 나눠 붙이면 열쇠 뒤에 `#번호` 가 붙습니다. 앞부분이 같으면 같은 줄입니다.
  for (const r of payKeys.rows) if (r.source_key) existing.add(r.source_key.split("#")[0]);

  // ── 앱이 보낸 청구서 ──────────────────────────────────────────────────
  //
  // 올톡페이로 보낼 때 청구사유 앞에 `[2026-0012]` 를 박아 둡니다(`withInvoiceNo`). 되받은
  // 줄에 그 번호가 있으면 청구서를 또 만들지 않고 **그 장에 입금만 붙입니다.** 번호로 찾으니
  // 동명이인·형제 합산 줄도 사람이 안 봐도 됩니다.
  const nos = [...new Set(raws.flatMap((r) => invoiceNosOf(r.why)))];
  const invoicesByNo = new Map<string, AppInvoice>();
  if (nos.length > 0) {
    const { data: invRows, error: invErr } = await supabase
      .from("invoices")
      .select("id, invoice_no, student_id, student_name_ko, student_name, total_amount, status")
      .in("invoice_no", nos);
    if (invErr) return NextResponse.json({ error: `청구서를 읽지 못했습니다: ${invErr.message}` }, { status: 500 });
    type InvRow = { id: string; invoice_no: string; student_id: string | null; student_name_ko: string | null; student_name: string; total_amount: number | string; status: string };
    const invs = ((invRows ?? []) as InvRow[]).filter((v) => v.status !== "취소");
    const paidBy = new Map<string, number>();
    if (invs.length > 0) {
      const { data: payRows, error: payErr } = await supabase
        .from("payments")
        .select("invoice_id, amount")
        .in("invoice_id", invs.map((v) => v.id));
      if (payErr) return NextResponse.json({ error: `입금을 읽지 못했습니다: ${payErr.message}` }, { status: 500 });
      for (const p of (payRows ?? []) as { invoice_id: string | null; amount: number | string }[]) {
        if (p.invoice_id) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Math.round(Number(p.amount)));
      }
    }
    for (const v of invs) {
      invoicesByNo.set(v.invoice_no, {
        id: v.id,
        invoiceNo: v.invoice_no,
        studentId: v.student_id,
        studentName: v.student_name_ko ?? v.student_name,
        total: Math.round(Number(v.total_amount)),
        paid: paidBy.get(v.id) ?? 0,
        status: v.status,
      });
    }
  }

  const planned = buildImportPlan(raws, students, existing, invoicesByNo);
  const summary = summarizePlan(planned);

  const { data: batch, error: batchErr } = await supabase
    .from("payment_imports")
    .insert({ source: "올톡페이", file_name: fileName, uploaded_by: me.email, status: "검수중" })
    .select()
    .single();
  if (batchErr || !batch) {
    return NextResponse.json({ error: `묶음을 만들지 못했습니다: ${batchErr?.message}` }, { status: 500 });
  }

  const { error: rowErr } = await supabase.from("payment_import_rows").insert(
    planned.map((p, i) => ({
      batch_id: batch.id as string,
      seq: p.raw.seq || i + 1,
      raw_name: p.raw.name,
      raw_phone: p.raw.phone || null,
      raw_why: p.raw.why || null,
      amount: Math.round(Number(p.raw.amount)),
      issued_at: p.raw.issuedAt || null,
      atp_status: p.raw.status || null,
      paid_at: p.raw.paidAt || null,
      method: p.raw.method || null,
      card: p.raw.card || null,
      approval_no: p.raw.approvalNo && p.raw.approvalNo !== "-" ? p.raw.approvalNo : null,
      item_name: p.itemName,
      stream: p.stream,
      match_kind: p.match,
      suggested_student_id: p.suggestedStudentId,
      match_why: p.why,
      plan: p.plan,
      source_key: p.sourceKey,
      matched_invoice_nos: p.matchedInvoiceNos.length > 0 ? p.matchedInvoiceNos : null,
      // **건너뛸 줄은 미리 건너뜀으로 둡니다.** 결제중단·이미 있음까지 사람이 하나씩
      // 누르게 하면, 정작 봐야 할 줄이 그 사이에 묻힙니다.
      // **번호·금액이 맞는 줄은 승인된 채로 둡니다.** 사람이 볼 것이 없는 줄까지 누르게 하면
      // 285줄 중 봐야 할 36줄이 그 사이에 묻힙니다. 반영 단추는 그래도 사람이 누릅니다.
      decision: p.plan === "건너뜀" ? "건너뜀" : p.preApproved ? "승인" : "대기",
    })),
  );
  if (rowErr) {
    // 줄을 못 넣었으면 묶음도 지웁니다. 빈 묶음이 목록에 남으면 「올렸는데 왜 비어 있지」가 됩니다.
    await supabase.from("payment_imports").delete().eq("id", batch.id);
    return NextResponse.json({ error: `줄을 담지 못했습니다: ${rowErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, batchId: batch.id, summary });
}
