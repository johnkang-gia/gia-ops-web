import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { buildBillPlan, type BillInvoice } from "@/lib/alltalkpay";
import { todayKst } from "@/lib/kst";

// 올톡페이 대량발송 파일에 넣을 내용을 서버에서 만듭니다.
//
// 화면이 들고 있는 값으로 만들지 않는 이유: 금액과 항목 이름은 **발행 시점에 굳은 값**이어야
// 합니다. 화면의 표는 지금 기준으로 계산된 값이라, 책값이 오른 뒤라면 이미 보낸 청구서와
// 다른 금액이 파일에 들어갑니다.
//
// `mark: true` 로 다시 부르면 내보낸 표시를 남깁니다. 표시가 남아야 다음 사람이 같은 명단을
// 두 번 올려 학부모에게 청구서가 두 번 가는 일을 막을 수 있습니다.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.invoiceIds) ? (body.invoiceIds as string[]).filter((v) => typeof v === "string") : [];
  const mergeSiblings = !!body?.mergeSiblings;
  const mark = !!body?.mark;
  if (ids.length === 0) return NextResponse.json({ error: "내보낼 청구서를 골라주세요." }, { status: 400 });

  const supabase = await createClient();

  if (mark) {
    const batch = `${todayKst()} ${me.name || me.email}`;
    const { error } = await supabase
      .from("invoices")
      .update({ exported_at: new Date().toISOString(), export_batch: batch })
      .in("id", ids);
    // 표시를 못 남겼으면 조용히 넘기지 않습니다. 파일은 이미 내려갔는데 표시가 없으면
    // 다음 사람이 같은 명단을 또 올립니다.
    if (error) return NextResponse.json({ error: `내보낸 표시를 남기지 못했습니다: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, marked: ids.length, batch });
  }

  const [invRes, lineRes] = await Promise.all([
    supabase.from("invoices").select("*").in("id", ids).eq("status", "발행"),
    supabase.from("invoice_lines").select("invoice_id, seq, name").in("invoice_id", ids).order("seq"),
  ]);
  if (invRes.error) return NextResponse.json({ error: invRes.error.message }, { status: 500 });
  if (lineRes.error) return NextResponse.json({ error: lineRes.error.message }, { status: 500 });

  const namesByInvoice = new Map<string, string[]>();
  for (const l of (lineRes.data as { invoice_id: string; name: string }[] | null) ?? []) {
    namesByInvoice.set(l.invoice_id, [...(namesByInvoice.get(l.invoice_id) ?? []), l.name]);
  }

  type Row = {
    id: string; invoice_no: string; student_id: string | null; student_name: string;
    student_name_ko: string | null; grade_label: string | null; total_amount: number;
    due_date: string; guardian_phone: string | null; exported_at: string | null;
  };
  const invoices = ((invRes.data as Row[] | null) ?? []).map<BillInvoice>((v) => ({
    ...v,
    itemNames: namesByInvoice.get(v.id) ?? [],
  }));

  // 발행 당시 연락처가 비어 있던 청구서는 지금 명부에서 한 번 더 찾아봅니다. 그 사이에
  // 명부가 채워졌을 수 있는데, 굳은 값만 보고 "연락처 없음"으로 빼면 그 아이만 청구가 안 갑니다.
  const needPhone = invoices.filter((v) => !v.guardian_phone && v.student_id).map((v) => v.student_id as string);
  if (needPhone.length > 0) {
    const { data, error } = await supabase.from("wr_students").select("id, parent_phone").in("id", needPhone);
    if (error) console.error("[올톡페이] 명부 연락처를 읽지 못했습니다:", error.message);
    const byId = new Map((((data as { id: string; parent_phone: string | null }[] | null) ?? [])).map((s) => [s.id, s.parent_phone]));
    for (const v of invoices) if (!v.guardian_phone && v.student_id) v.guardian_phone = byId.get(v.student_id) ?? null;
  }

  return NextResponse.json({ ok: true, plan: buildBillPlan(invoices, { mergeSiblings }) });
}
