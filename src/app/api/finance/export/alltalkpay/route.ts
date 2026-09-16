import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { buildBillPlan, type BillInvoice, type GuardianRole, phonesOf, chosenRoleOf, type GuardianPhones } from "@/lib/alltalkpay";
import { todayKst } from "@/lib/kst";
import { selectTolerant } from "@/lib/selectTolerant";

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
  // 화면에서 청구서마다 대상을 바꾼 것(어머니 ↔ 아버지 ↔ 보호자). 서버에서 한 번 더 걸러
  // 받습니다 - 화면이 보낸 값을 그대로 믿고 돌리면 엉뚱한 값이 들어와도 알 수 없습니다.
  const roleOverrides: Record<string, GuardianRole> = {};
  const rawOverrides = body?.roleOverrides;
  if (rawOverrides && typeof rawOverrides === "object") {
    for (const [id, role] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (role === "mother" || role === "father" || role === "guardian") roleOverrides[id] = role;
    }
  }
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
    due_date: string; guardian_phone: string | null; guardian_role: string | null;
    exported_at: string | null;
    /** 이미 받은 돈을 적기만 한 장인가. 이런 장은 보내면 안 됩니다. */
    issued_offline: boolean | null;
    // 청구 내용 문구가 「학비 납부」인지 「학비외 납부」인지를 가릅니다. 옛 줄은 stream 이
    // 비어 있어 category 로 되짚습니다.
    stream: string | null; category: string | null;
  };
  /**
   * **이미 받은 것을 적기만 한 장은 빼고 만듭니다.**
   *
   * 「이미 받음」으로 만든 장은 받은 돈을 장부에 남기려고 만든 것이라 학부모에게는 청구할
   * 것이 없습니다. 그대로 보내면 이미 낸 분께 또 내라는 문자가 나갑니다 - 되돌릴 수 없고,
   * 우리 화면에는 「보냄」으로만 남아 아무도 못 찾습니다.
   *
   * 화면도 안 담지만 여기서도 막습니다. 보내는 창구가 마지막 문이라, 여기서 새면 앞의
   * 조심이 전부 소용없습니다.
   */
  const all = (invRes.data as Row[] | null) ?? [];
  const rows = all.filter((v) => v.issued_offline !== true);
  const skipped = all.filter((v) => v.issued_offline === true).map((v) => v.invoice_no);

  // 지금 명부의 세 칸을 함께 읽어옵니다.
  //
  // 발행할 때 굳혀 둔 번호만 보고 만들지 않는 이유: 발행 뒤에 명부를 채우거나 고치는 일이
  // 흔합니다. 굳은 값만 보면 그 사이에 번호를 넣어 준 아이가 계속 빠지고, 화면에서 어머니 ↔
  // 아버지를 바꾸는 것도 불가능합니다. 굳은 값은 명부에 아무것도 없을 때의 마지막 보루로
  // 남겨 둡니다.
  const studentIds = [...new Set(rows.map((v) => v.student_id).filter(Boolean) as string[])];
  // 명부에서 읽어오는 것은 번호 네 칸과 **학교가 고른 대상**입니다. 대상을 함께 들고 와야
  // 「이 아이는 아버지로 정해 뒀다」가 내보내기에도 반영됩니다.
  const phonesById = new Map<string, GuardianPhones>();
  const chosenById = new Map<string, GuardianRole>();
  if (studentIds.length > 0) {
    const { data, error, missing } = await selectTolerant<{
      id: string; mother_phone?: string | null; father_phone?: string | null; parent_phone?: string | null;
      billing_phone_role?: string | null; billing_phone?: string | null;
    }>(
      (columns) =>
        supabase.from("wr_students").select(columns).eq("is_demo", false).in("id", studentIds) as unknown as
          PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>,
      ["id"],
      ["mother_phone", "father_phone", "parent_phone", "billing_phone_role", "billing_phone"],
    );
    if (missing.length > 0) {
      console.error("[올톡페이] 명부에 없는 연락처 칸:", missing.join(", "));
    }
    if (error) {
      // 명부를 못 읽으면 굳은 번호로만 만들게 됩니다. 조용히 넘기면 왜 몇 명이 빠졌는지
      // 아무도 모르므로 기록은 남깁니다.
      console.error("[올톡페이] 명부 연락처를 읽지 못했습니다:", error);
    }
    for (const s of data) {
      const b = {
        billing_phone_role: s.billing_phone_role ?? null,
        billing_phone: s.billing_phone ?? null,
        mother_phone: s.mother_phone ?? null,
        father_phone: s.father_phone ?? null,
        parent_phone: s.parent_phone ?? null,
      };
      phonesById.set(s.id, phonesOf(b));
      const chosen = chosenRoleOf(b);
      if (chosen) chosenById.set(s.id, chosen);
    }
  }

  const invoices = rows.map<BillInvoice>((v) => ({
    ...v,
    // 발행할 때 고른 것이 먼저이고, 없으면 **그 아이의 결제번호**를 씁니다. 예전에 발행한
    // 청구서에는 고른 값이 없는데, 그렇다고 어머니로 되돌려 보내면 그 집은 못 받습니다.
    guardian_role:
      v.guardian_role === "direct" || v.guardian_role === "mother" || v.guardian_role === "father" ||
      v.guardian_role === "guardian" || v.guardian_role === "manual"
        ? v.guardian_role
        : (v.student_id ? chosenById.get(v.student_id) : undefined) ?? null,
    phones:
      (v.student_id ? phonesById.get(v.student_id) : undefined) ??
      { billing_phone: null, mother_phone: null, father_phone: null, parent_phone: null },
    itemNames: namesByInvoice.get(v.id) ?? [],
  }));

  // 뺀 것이 있으면 **말해줍니다**(§5). 조용히 빼면 몇 명이 왜 빠졌는지 아무도 모릅니다.
  return NextResponse.json({
    ok: true,
    plan: buildBillPlan(invoices, { mergeSiblings, roleOverrides }),
    skipped,
  });
}
