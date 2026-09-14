import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { buildImportPlan, summarizePlan, type RawImportRow, type StudentLite } from "@/lib/paymentImport";
import { readAll } from "@/lib/financeFetch";

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
  const { data: stuRows, error: stuErr } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name, mother_phone, father_phone, parent_phone, billing_phone")
    .eq("is_demo", false)
    .eq("status", "active");
  if (stuErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${stuErr.message}` }, { status: 500 });

  const students: StudentLite[] = (
    (stuRows ?? []) as {
      id: string;
      name: string;
      grade: string | null;
      class_name: string | null;
      mother_phone: string | null;
      father_phone: string | null;
      parent_phone: string | null;
      billing_phone: string | null;
    }[]
  ).map((s) => ({
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
  for (const r of payKeys.rows) if (r.source_key) existing.add(r.source_key);

  const planned = buildImportPlan(raws, students, existing);
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
      // **건너뛸 줄은 미리 건너뜀으로 둡니다.** 결제중단·이미 있음까지 사람이 하나씩
      // 누르게 하면, 정작 봐야 할 줄이 그 사이에 묻힙니다.
      decision: p.plan === "건너뜀" ? "건너뜀" : "대기",
    })),
  );
  if (rowErr) {
    // 줄을 못 넣었으면 묶음도 지웁니다. 빈 묶음이 목록에 남으면 「올렸는데 왜 비어 있지」가 됩니다.
    await supabase.from("payment_imports").delete().eq("id", batch.id);
    return NextResponse.json({ error: `줄을 담지 못했습니다: ${rowErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, batchId: batch.id, summary });
}
