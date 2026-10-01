import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { loadStudents } from "@/lib/students";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  seq: number;
  raw_name: string | null;
  raw_phone: string | null;
  raw_why: string | null;
  amount: number | string;
  issued_at: string | null;
  paid_at: string | null;
  method: string | null;
  item_name: string | null;
  stream: string | null;
  plan: string;
  decision: string;
  source_key: string;
  suggested_student_id: string | null;
  decided_student_id: string | null;
  applied_at: string | null;
  matched_invoice_nos: string[] | null;
};

/**
 * **승인한 줄을 실제 표로 내보냅니다.**
 *
 * ── 무엇이 만들어지나 ──────────────────────────────────────────────────────
 *
 * 올톡페이 한 줄은 **청구서 한 장**입니다 - 결제까지 됐으면 거기에 입금도 붙습니다. 앱에는
 * 그 청구서가 아예 없으므로 대부분 청구서를 만드는 데서 시작합니다.
 *
 *   · 결제완료 → 청구서 + 입금  (완납으로 잡힙니다)
 *   · 발송완료 → 청구서만       (미납금 화면에 저절로 뜹니다)
 *   · 앱이 보낸 청구서(번호가 적힌 줄) → **그 장에 입금만.** 청구서를 또 만들면 같은 돈이
 *     두 장으로 잡힙니다. 형제를 합쳐 보낸 줄은 장마다 남은 금액만큼 차례로 나눕니다.
 *
 * ── 한 줄이 실패해도 나머지는 계속합니다 ───────────────────────────────────
 *
 * 285줄 중 하나가 실패했다고 전부 멈추면, 다시 돌릴 때 앞의 200줄이 두 번 들어갑니다.
 * 대신 **실패한 줄에 이유를 적고** 그 줄만 다시 하게 합니다. 열쇠(`source_key`)에 유일
 * 색인이 걸려 있어 이미 들어간 줄은 두 번 안 들어갑니다.
 *
 * ── 순서가 뜻을 가집니다 ───────────────────────────────────────────────────
 *
 * 청구서를 **만든 뒤에** 입금을 붙입니다. 반대로 하면 입금이 갈 곳 없이 떠 있는 순간이
 * 생기고, 그 사이에 실패하면 선입금으로 남습니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { batchId?: string } | null;
  const batchId = body?.batchId;
  if (!batchId) return NextResponse.json({ error: "묶음을 고르지 못했습니다." }, { status: 400 });

  const supabase = await createClient();

  const { data: batch, error: bErr } = await supabase.from("payment_imports").select("*").eq("id", batchId).maybeSingle();
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "그 묶음을 찾지 못했습니다." }, { status: 404 });

  // **승인했고 아직 안 나간 줄만** 가져옵니다. 「대기」를 함께 내보내면 아무도 안 본 것이
  // 나가고, 그러면 검수하는 뜻이 없습니다.
  const { data: rowData, error: rErr } = await supabase
    .from("payment_import_rows")
    .select("*")
    .eq("batch_id", batchId)
    .eq("decision", "승인")
    .is("applied_at", null)
    .order("seq");
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  const rows = (rowData ?? []) as Row[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "승인한 줄이 없습니다. 먼저 검수해서 승인해주세요." }, { status: 400 });
  }

  // 청구서에 적을 학생 이름·학년. 명부 이름이 먼저입니다 - 올톡페이 고객명 칸은 자유
  // 글자라 사유가 섞여 있습니다(「강하라/치과진료비12,900원포함」).
  const ids = [...new Set(rows.map((r) => r.decided_student_id ?? r.suggested_student_id).filter(Boolean))] as string[];
  // 승인한 줄이 가리키는 학생 번호로 찍어 읽습니다. 퇴소한 아이의 결제도 들어올 수 있습니다.
  const { rows: stu } = await loadStudents(supabase, { ids, status: "all" });
  const byId = new Map(stu.map((s) => [s.id, s]));

  let madeInvoices = 0;
  let madePayments = 0;
  const failures: { seq: number; name: string; error: string }[] = [];

  for (const r of rows) {
    const studentId = r.decided_student_id ?? r.suggested_student_id;
    const amount = Math.round(Number(r.amount));
    const issue = r.issued_at ?? r.paid_at ?? null;

    const fail = async (msg: string) => {
      failures.push({ seq: r.seq, name: r.raw_name ?? "", error: msg });
      await supabase.from("payment_import_rows").update({ apply_error: msg }).eq("id", r.id);
    };

    if (!issue) {
      await fail("날짜가 없습니다. 파일에 등록일자·수납일자가 있는지 확인해주세요.");
      continue;
    }
    if (!(amount > 0)) {
      await fail(`금액이 이상합니다: ${r.amount}`);
      continue;
    }

    // ── ⓪ 앱이 보낸 청구서에 붙이기 ──────────────────────────────────
    //
    // 학생 검사보다 **앞에** 있습니다. 형제를 합쳐 보낸 줄은 학생이 둘이라 「고른 학생」이
    // 비어 있는데, 청구서가 각자 학생을 알고 있으니 고를 필요가 없습니다.
    if (r.matched_invoice_nos && r.matched_invoice_nos.length > 0) {
      if (r.plan !== "수납만 붙이기") {
        await fail(`앱 청구서(${r.matched_invoice_nos.join(", ")})가 있는 줄은 입금만 붙입니다. 판정이 「${r.plan}」이라 멈췄습니다.`);
        continue;
      }
      const { data: invs, error: invErr } = await supabase
        .from("invoices")
        .select("id, invoice_no, student_id, student_name_ko, student_name, total_amount, status")
        .in("invoice_no", r.matched_invoice_nos);
      if (invErr) {
        await fail(`청구서를 읽지 못했습니다: ${invErr.message}`);
        continue;
      }
      type Inv = { id: string; invoice_no: string; student_id: string | null; student_name_ko: string | null; student_name: string; total_amount: number | string; status: string };
      const list = ((invs ?? []) as Inv[]).filter((v) => v.status !== "취소");
      if (list.length !== r.matched_invoice_nos.length) {
        await fail(`청구서 ${r.matched_invoice_nos.join(", ")} 중 지금은 없는(취소된) 장이 있습니다. 다시 올려서 판정해주세요.`);
        continue;
      }
      const { data: prior } = await supabase.from("payments").select("invoice_id, amount").in("invoice_id", list.map((v) => v.id));
      const paidBy = new Map<string, number>();
      for (const p of (prior ?? []) as { invoice_id: string | null; amount: number | string }[]) {
        if (p.invoice_id) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Math.round(Number(p.amount)));
      }
      // 번호 순서대로 남은 만큼 채웁니다. 남는 돈은 **마지막 장에** 붙입니다 - 떠 있는 선입금으로
      // 두면 아무 장에도 안 보이고, 과납은 그 장의 과납으로 보여야 사람이 예치금으로 돌릴 수 있습니다.
      let left = amount;
      let lastPaymentId: string | null = null;
      let ok = true;
      for (let i = 0; i < list.length; i += 1) {
        const v = list[i];
        const remaining = Math.max(0, Math.round(Number(v.total_amount)) - (paidBy.get(v.id) ?? 0));
        const share = i === list.length - 1 ? left : Math.min(remaining, left);
        if (share <= 0) continue;
        const { data: pay, error: payErr } = await supabase
          .from("payments")
          .insert({
            invoice_id: v.id,
            student_id: v.student_id,
            paid_at: r.paid_at ?? issue,
            amount: share,
            kind: "입금",
            method: r.method ?? "올톡페이",
            method_kind: r.method && /카드|현금|계좌/.test(r.method) ? r.method : "올톡페이",
            payer_name: v.student_name_ko ?? v.student_name,
            memo: `올톡페이 ${r.raw_why ?? ""}`.trim(),
            source: "올톡페이 가져오기",
            origin: "올톡페이",
            // 한 줄을 여러 장에 나누면 열쇠도 장마다 달라야 유일 색인을 지나갑니다.
            source_key: list.length === 1 ? r.source_key : `${r.source_key}#${v.invoice_no}`,
            matched_by: me.email,
            created_by: me.email,
          })
          .select("id")
          .single();
        if (payErr || !pay) {
          const dup = /duplicate key|unique/i.test(payErr?.message ?? "");
          await fail(dup ? `청구서 ${v.invoice_no} 에는 이미 이 입금이 붙어 있습니다.` : `청구서 ${v.invoice_no} 에 입금을 못 붙였습니다: ${payErr?.message}`);
          ok = false;
          break;
        }
        lastPaymentId = pay.id as string;
        madePayments += 1;
        left -= share;
      }
      if (!ok) continue;
      await supabase
        .from("payment_import_rows")
        .update({ applied_invoice_id: list[0].id, applied_payment_id: lastPaymentId, applied_at: new Date().toISOString(), apply_error: null })
        .eq("id", r.id);
      continue;
    }

    let invoiceId: string | null = null;

    if (!studentId) {
      await fail("학생이 정해지지 않았습니다. 누구 것인지 골라주세요.");
      continue;
    }
    const s = byId.get(studentId);
    if (!s) {
      await fail("고른 학생을 명부에서 찾지 못했습니다.");
      continue;
    }
    // ── ① 청구서 ─────────────────────────────────────────────────────
    if (r.plan === "청구서 만들고 수납" || r.plan === "청구서만 만들기(미납)") {
      const { data: noRow, error: noErr } = await supabase.rpc("next_invoice_no");
      if (noErr) {
        await fail(`번호를 만들지 못했습니다: ${noErr.message}`);
        continue;
      }
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert({
          invoice_no: noRow as unknown as string,
          stream: r.stream === "학비" ? "학비" : "학비외",
          category: r.stream === "학비" ? "학비" : null,
          student_id: studentId,
          student_name: s.name_en ?? s.name,
          student_name_ko: s.name,
          grade_label: s.class_name ?? (s.grade ? `${s.grade}학년` : null),
          issue_date: issue,
          // 청구월은 **보낸 달**입니다. 결제한 달로 두면 8월분을 9월에 낸 건이 9월로 잡혀
          // 그 달 청구액이 실제보다 커집니다.
          billing_month: issue.slice(0, 7),
          due_date: issue,
          total_amount: amount,
          status: "발행",
          // 올톡페이로 이미 나간 건입니다. 다시 보내지 않도록 내보낸 표시를 함께 답니다.
          exported_at: new Date().toISOString(),
          guardian_phone: r.raw_phone,
          note: `올톡페이에서 가져옴 (${r.raw_why ?? ""})`,
          import_source_key: r.source_key,
          issued_by: me.email,
        })
        .select()
        .single();
      if (invErr || !inv) {
        // 유일 색인에 걸렸으면 이미 들어간 줄입니다. 그건 실패가 아니라 **이미 됨**입니다.
        const dup = /duplicate key|unique/i.test(invErr?.message ?? "");
        await fail(dup ? "이미 들어와 있는 줄입니다(같은 열쇠의 청구서가 있습니다)." : `청구서를 만들지 못했습니다: ${invErr?.message}`);
        continue;
      }
      invoiceId = inv.id as string;
      madeInvoices += 1;

      // 줄 이름에 **원문 사유를 함께** 적습니다. 정리한 이름만 두면 학부모가 받은 문자와
      // 대조할 수 없고, 정리가 틀렸을 때 무엇 때문인지 알 수 없습니다.
      const lineName =
        r.raw_why && r.raw_why !== r.item_name ? `${r.item_name ?? "항목"} (${r.raw_why})` : (r.item_name ?? "항목");
      const { error: lineErr } = await supabase
        .from("invoice_lines")
        .insert({ invoice_id: invoiceId, seq: 1, name: lineName, qty: 1, unit_price: amount, amount });
      if (lineErr) {
        await fail(`청구서(${inv.invoice_no})는 만들었지만 내역을 못 넣었습니다: ${lineErr.message}. 그 청구서를 취소하고 다시 해주세요.`);
        continue;
      }
    }

    // ── ② 입금 ───────────────────────────────────────────────────────
    let paymentId: string | null = null;
    if (r.plan === "청구서 만들고 수납" || r.plan === "수납만 붙이기") {
      const { data: pay, error: payErr } = await supabase
        .from("payments")
        .insert({
          invoice_id: invoiceId,
          student_id: studentId,
          paid_at: r.paid_at ?? issue,
          amount,
          kind: "입금",
          method: r.method ?? "올톡페이",
          method_kind: r.method && /카드|현금|계좌/.test(r.method) ? r.method : "올톡페이",
          payer_name: s.name,
          memo: `올톡페이 ${r.raw_why ?? ""}`.trim(),
          source: "올톡페이 가져오기",
          origin: "올톡페이",
          source_key: r.source_key,
          matched_by: me.email,
          created_by: me.email,
        })
        .select()
        .single();
      if (payErr || !pay) {
        const dup = /duplicate key|unique/i.test(payErr?.message ?? "");
        await fail(
          dup
            ? "이미 들어와 있는 입금입니다(같은 승인번호)."
            : `청구서는 만들었지만 입금을 못 넣었습니다: ${payErr?.message}. 수납 화면에서 직접 붙여주세요.`,
        );
        continue;
      }
      paymentId = pay.id as string;
      madePayments += 1;
    }

    await supabase
      .from("payment_import_rows")
      .update({
        applied_invoice_id: invoiceId,
        applied_payment_id: paymentId,
        applied_at: new Date().toISOString(),
        apply_error: null,
      })
      .eq("id", r.id);
  }

  // 남은 대기가 없으면 묶음을 닫습니다. 남아 있으면 **검수중으로 둡니다** - 며칠에 걸쳐
  // 나눠 보는 것이 정상이고, 닫아버리면 남은 줄로 돌아갈 길이 헷갈립니다.
  const { count: waiting } = await supabase
    .from("payment_import_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("decision", "대기");

  if ((waiting ?? 0) === 0) {
    await supabase
      .from("payment_imports")
      .update({ status: "반영됨", applied_at: new Date().toISOString(), applied_by: me.email })
      .eq("id", batchId);
  }

  return NextResponse.json({
    ok: true,
    tried: rows.length,
    madeInvoices,
    madePayments,
    failed: failures.length,
    failures: failures.slice(0, 20),
    stillWaiting: waiting ?? 0,
  });
}
