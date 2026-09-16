import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { lockCarried } from "@/lib/carryForward";
import { carryForwardLineName, type SettleInvoice } from "@/lib/settlement";
import { phonesOf, chosenRoleOf, resolveRecipient, type StudentBilling } from "@/lib/alltalkpay";

export const dynamic = "force-dynamic";

/**
 * **고른 미납 청구서들을 한 장으로 합칩니다.**
 *
 * ── 왜 사람이 고르나 ────────────────────────────────────────────────────────
 *
 * 예전에는 새 청구서를 발행할 때마다 지난 미납이 저절로 얹혔습니다. 실측에서 그렇게 커진
 * 청구서는 **한 건도 안 걷혔습니다**(200만 초과 7건 3,190만원, 수납 0원).
 *
 * 그래서 합치는 것을 발행에서 떼어내 여기로 옮겼습니다. 사람이 미납금 화면에서 무엇을 합칠지
 * 고르고, 합계가 크면 화면이 말립니다. 대부분의 경우 **따로 다시 보내는 편**이 낫습니다 -
 * 30만 이하 구간이 57.8% 로 가장 잘 걷혔습니다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────────
 *
 * 새 청구서를 **만든 뒤에** 원본을 잠급니다. 먼저 잠그면 만들다 실패했을 때 원 미납이
 * 어디로도 가지 않은 채 사라집니다(`carryForward.ts` 와 같은 규칙).
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { invoiceIds?: string[]; dueDate?: string } | null;
  const ids = (body?.invoiceIds ?? []).filter((x) => typeof x === "string");
  /**
   * **한 건도 됩니다.** 여기가 「합치기」만 하는 창구가 아닙니다.
   *
   * 청구서 한 장에 일부만 입금되는 일이 흔합니다 - 300만원을 청구했는데 100만원이 들어온
   * 식입니다. 남은 200만원을 다시 받으려면 원 청구서를 그대로 또 보낼 수밖에 없었는데,
   * 그러면 **학부모 화면에 300만원이 다시 뜹니다.** 이미 낸 100만원이 안 보이니 「냈는데
   * 왜 또」가 되고, 그 청구서는 대개 그대로 남습니다.
   *
   * 남은 금액으로 새 장을 만들면 학부모가 보는 숫자가 실제로 내야 할 돈과 같아집니다.
   */
  if (ids.length < 1) return NextResponse.json({ error: "다시 청구할 청구서를 골라주세요." }, { status: 400 });

  const supabase = await createClient();

  const { data: invs, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, student_name, student_name_ko, grade_label, issue_date, due_date, total_amount, status, category, stream, carried_to_invoice_id")
    .in("id", ids);
  if (invErr) return NextResponse.json({ error: `청구서를 읽지 못했습니다: ${invErr.message}` }, { status: 500 });
  const rows = (invs ?? []) as unknown as (SettleInvoice & { grade_label: string | null })[];
  if (rows.length !== ids.length) return NextResponse.json({ error: "고른 청구서 중 일부를 찾지 못했습니다." }, { status: 404 });

  // ── 합치면 안 되는 조합은 **막습니다.** ────────────────────────────────────
  //
  // 화면이 이미 걸러주지만, 화면에서 안 보여주는 것은 예의이지 자물쇠가 아닙니다
  // (CLAUDE.md 2-8). 여기서 통과하면 되돌릴 수 없는 상태가 만들어집니다.
  const already = rows.filter((v) => v.status !== "발행" || v.carried_to_invoice_id);
  if (already.length > 0) {
    return NextResponse.json(
      { error: `이미 취소됐거나 합쳐진 청구서가 있습니다: ${already.map((v) => v.invoice_no).join(", ")}` },
      { status: 400 },
    );
  }
  const studentIds = new Set(rows.map((v) => v.student_id).filter(Boolean));
  if (studentIds.size !== 1) {
    // **학생이 섞이면 남의 돈이 청구됩니다.** 동명이인이 셋인 학교라 이름만 보고 묶으면
    // 실제로 일어납니다(CLAUDE.md 2-4-1).
    return NextResponse.json({ error: "한 학생의 청구서끼리만 합칠 수 있습니다." }, { status: 400 });
  }
  const studentId = [...studentIds][0] as string;

  // 아직 안 받은 금액만 합칩니다. 일부 낸 건을 청구액 그대로 얹으면 이미 낸 돈을 또 청구합니다.
  const { data: pays, error: payErr } = await supabase.from("payments").select("invoice_id, amount").in("invoice_id", ids);
  if (payErr) return NextResponse.json({ error: `입금을 읽지 못했습니다: ${payErr.message}` }, { status: 500 });
  const paidBy = new Map<string, number>();
  for (const p of (pays ?? []) as { invoice_id: string; amount: number | string }[]) {
    paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Number(p.amount));
  }

  const lines = rows
    .map((v) => ({ v, balance: Number(v.total_amount) - (paidBy.get(v.id) ?? 0) }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => a.v.issue_date.localeCompare(b.v.issue_date));
  // 다 받은 것만 골랐으면 만들 것이 없습니다. 0원짜리 청구서를 만들면 학부모에게 0원 고지가
  // 가고, 그건 오류가 아니라 「이상한 청구서」로 보입니다.
  if (lines.length === 0) {
    return NextResponse.json({ error: "고른 청구서에 아직 안 받은 금액이 없습니다." }, { status: 400 });
  }

  const total = lines.reduce((n, x) => n + x.balance, 0);
  const stream = lines[0].v.stream === "학비" || lines[0].v.category === "학비" ? "학비" : "학비외";

  // 받는 번호는 **학생별 결제번호**가 기본입니다(@/lib/alltalkpay 한 곳에서 판정).
  const { data: stu } = await supabase
    // 명부 목록을 그리는 자리가 아니라, 청구서에 적힌 학생 번호로 **그 한 명**을 찍어
    // 읽습니다. is_demo 로 거르면 연습용 청구서에서만 결제번호가 조용히 안 붙습니다.
    // demo-ok: 번호로 한 명을 찍어 읽습니다. 명부를 훑지 않습니다.
    .from("wr_students")
    .select("billing_phone_role, billing_phone, mother_phone, father_phone, parent_phone")
    .eq("id", studentId)
    .maybeSingle();
  const billing = (stu ?? { billing_phone_role: null, billing_phone: null, mother_phone: null, father_phone: null, parent_phone: null }) as StudentBilling;
  const recipient = resolveRecipient(phonesOf(billing), chosenRoleOf(billing));

  const { data: noRow, error: noErr } = await supabase.rpc("next_invoice_no");
  if (noErr) return NextResponse.json({ error: `번호를 만들지 못했습니다: ${noErr.message}` }, { status: 500 });

  const issue = todayKst();
  const due = body?.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : issue;
  const head = lines[0].v;

  const { data: inv, error: mkErr } = await supabase
    .from("invoices")
    .insert({
      invoice_no: noRow as unknown as string,
      stream,
      student_id: studentId,
      student_name: head.student_name,
      student_name_ko: head.student_name_ko ?? null,
      grade_label: head.grade_label ?? null,
      issue_date: issue,
      // 합친 청구서는 **오늘 것**입니다. 원 청구서의 달로 두면 지난달 숫자가 다시 움직입니다.
      billing_month: issue.slice(0, 7),
      due_date: due,
      total_amount: total,
      status: "발행",
      // **적는 말이 사실과 같아야 합니다.** 한 건짜리에 「합침」이라고 적으면, 나중에 이
      // 줄을 보는 사람은 어디에 합쳐졌는지를 찾다가 없는 것을 찾게 됩니다.
      note:
        lines.length === 1
          ? `${lines[0].v.invoice_no} 의 남은 금액을 다시 청구 (원 청구액 ${Math.round(Number(lines[0].v.total_amount)).toLocaleString("ko-KR")}원 중 ${Math.round(total).toLocaleString("ko-KR")}원 미납)`
          : `미납 ${lines.length}건을 합침 (${lines.map((x) => x.v.invoice_no).join(", ")})`,
      guardian_phone: recipient?.phone ?? null,
      guardian_role: recipient?.role ?? null,
      issued_by: me.email,
    })
    .select()
    .single();
  if (mkErr || !inv) return NextResponse.json({ error: `청구서를 만들지 못했습니다: ${mkErr?.message}` }, { status: 500 });

  // 줄 이름에 **원 청구서 번호와 날짜**를 적습니다. 「미납인보이스 정산」이라고만 적으면
  // 학부모는 무슨 돈인지 모르고, 그러면 물어보지도 않고 그냥 안 냅니다.
  const { error: lineErr } = await supabase.from("invoice_lines").insert(
    lines.map((x, i) => ({
      invoice_id: inv.id as string,
      seq: i + 1,
      // 일부 낸 건은 **얼마를 냈는지**까지 줄 이름에 적습니다. 그래야 학부모가 남은 금액의
      // 까닭을 그 줄에서 바로 읽습니다.
      name: carryForwardLineName(x.v, paidBy.get(x.v.id) ?? 0),
      qty: 1,
      unit_price: x.balance,
      amount: x.balance,
    })),
  );
  if (lineErr) {
    return NextResponse.json(
      { error: `청구서(${inv.invoice_no})는 만들었지만 내역을 못 넣었습니다: ${lineErr.message}. 그 청구서를 취소하고 다시 해주세요.` },
      { status: 500 },
    );
  }

  // **만든 뒤에** 잠급니다. 실패하면 같은 돈이 두 곳에 미납으로 남으므로 조용히 넘기지 않습니다.
  const lockErr = await lockCarried(supabase, lines.map((x) => x.v.id), inv.id as string);
  if (lockErr) {
    return NextResponse.json(
      { error: `청구서(${inv.invoice_no})는 만들었지만 원 청구서를 잠그지 못했습니다: ${lockErr}. 같은 돈이 두 번 청구될 수 있으니 바로 확인해주세요.` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, invoice: inv, merged: lines.length, total });
}
