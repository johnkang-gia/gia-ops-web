import { NextResponse } from "next/server";
import { planCarryForward, lockCarried } from "@/lib/carryForward";
import { applyPrepaid } from "@/lib/prepaidApply";

import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { gradeLabel } from "@/lib/feeItems";
import { selectTolerant } from "@/lib/selectTolerant";
import { todayKst } from "@/lib/kst";
import { resolveRecipient, type GuardianRole } from "@/lib/alltalkpay";
import { tuitionLine, type TuitionLine } from "@/lib/tuition";
import type { FeePlan, FeePaymentOption, FeeDiscount } from "@/lib/types";

// 학비 청구서 발행.
//
// 학비외 항목(/api/finance/invoices)과 **표가 다릅니다.** 저쪽은 fee_items 를 학생에게
// 붙이는 방식이고, 이쪽은 「학부모가 서명해서 고른 납부 옵션」(student_fee_enrollments)이
// 근거입니다. 그래서 계산도 다릅니다 - 기준금액 × 회차수 × (1 − 옵션할인) − 추가할인.
//
// **금액은 서버가 다시 계산합니다.** 화면이 보낸 총액을 그대로 믿으면, 화면이 틀렸을 때
// 틀린 금액이 그대로 학부모에게 갑니다. 화면과 서버가 같은 함수(tuitionLine)를 쓰되
// 최종 값은 여기서 냅니다.
//
// 그리고 **그때의 이름과 금액을 베껴 굳힙니다.** 요금표를 참조만 하면, 나중에 학비가
// 오를 때 이미 보낸 청구서 금액까지 같이 바뀝니다.

export const dynamic = "force-dynamic";

type StudentRow = {
  id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null;
  department: string | null;
  mother_phone?: string | null; father_phone?: string | null; parent_phone?: string | null;
};

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const studentId = body?.studentId as string | undefined;
  const dueDate = (body?.dueDate as string | undefined) ?? null;
  const termId = (body?.termId as string | undefined) ?? null;
  /**
   * 어느 항목만 담을 것인가. 안 주면 그 학생의 학비 전부입니다.
   *
   * 정규과정과 방과후는 납기도 다르고 그만두는 시점도 다릅니다. 한 장에 섞으면 그 장이
   * 반만 결제된 상태가 되어, 「방과후만 이번 달 얼마 걷혔나」를 셀 수가 없습니다.
   */
  const planIds = Array.isArray(body?.planIds) ? (body.planIds as string[]).filter((v) => typeof v === "string") : null;
  /**
   * 이미 받은 돈. 주면 청구서를 **받은 날짜로** 만들고 「안 보냄」 표시를 단 뒤 입금까지
   * 함께 기록합니다 - 청구서가 있어야만 결제를 체크할 수 있으니, 이미 낸 분을 넣으려면
   * 이 한 걸음이 필요합니다.
   */
  const alreadyPaid = body?.alreadyPaid as { paidAt?: string; amount?: number; method?: string; memo?: string } | undefined;
  const paidAt = typeof alreadyPaid?.paidAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(alreadyPaid.paidAt) ? alreadyPaid.paidAt : null;
  const askedRole = body?.guardianRole;
  const guardianRole: GuardianRole | null =
    askedRole === "mother" || askedRole === "father" || askedRole === "guardian" ? askedRole : null;
  if (!studentId) return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();

  const [stuRes, planRes, optRes, enrollRes, sdRes, discRes] = await Promise.all([
    selectTolerant<StudentRow>(
      (columns) =>
        supabase.from("wr_students").select(columns).eq("is_demo", false).eq("id", studentId) as unknown as
          PromiseLike<{ data: StudentRow[] | null; error: { message: string } | null }>,
      ["id", "name", "name_en", "grade", "class_name", "department"],
      ["mother_phone", "father_phone", "parent_phone"],
    ),
    supabase.from("fee_plans").select("*").eq("category", "학비"),
    supabase.from("fee_payment_options").select("*"),
    // 학기를 안 건 옛 줄도 함께 봅니다. 학기가 생기기 전에 넣어둔 신청이 있고, 그걸 빼면
    // 그 학생만 조용히 청구에서 빠집니다.
    supabase.from("student_fee_enrollments").select("*").eq("student_id", studentId).eq("active", true),
    supabase.from("student_fee_discounts").select("*").eq("student_id", studentId).eq("active", true),
    supabase.from("fee_discounts").select("*"),
  ]);
  if (stuRes.error) return NextResponse.json({ error: stuRes.error }, { status: 500 });
  const err = planRes.error ?? optRes.error ?? enrollRes.error ?? sdRes.error ?? discRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const student = stuRes.data[0] ?? null;
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });

  const plans = (planRes.data as FeePlan[] | null) ?? [];
  const options = (optRes.data as FeePaymentOption[] | null) ?? [];
  const discounts = (discRes.data as FeeDiscount[] | null) ?? [];

  const sameTerm = <T extends { term_id?: string | null }>(r: T) => !r.term_id || !termId || r.term_id === termId;

  const enrollments = ((enrollRes.data as { plan_id: string; option_id: string | null; term_id: string | null }[] | null) ?? [])
    .filter(sameTerm)
    .filter((e) => !planIds || planIds.length === 0 || planIds.includes(e.plan_id));
  const studentDiscounts = ((sdRes.data as { discount_id: string; term_id: string | null }[] | null) ?? []).filter(sameTerm);

  // 이 학생에게 걸린 할인. **끈 할인도 그대로 씁니다** - 이미 붙어 있던 건을 빼면 학부모가
  // 들은 금액과 청구서가 달라집니다. 새로 붙이는 것만 화면에서 막습니다.
  const applied = studentDiscounts
    .map((sd) => discounts.find((d) => d.id === sd.discount_id))
    .filter((d): d is FeeDiscount => !!d);

  const lines: TuitionLine[] = [];
  for (const e of enrollments) {
    const plan = plans.find((p) => p.id === e.plan_id);
    if (!plan) continue;
    const option = options.find((o) => o.id === e.option_id) ?? null;
    // 항목에 딱 걸린 할인 + 학비 전체에 걸린 할인. 다른 항목 전용 할인은 여기 안 붙습니다.
    const forPlan = applied.filter((d) => !d.plan_id || d.plan_id === plan.id);
    const line = tuitionLine(plan, option, forPlan);
    if (line) lines.push(line);
  }

  if (lines.length === 0) {
    // 「고른 것이 없다」와 「고른 것은 있는데 이번에 담을 항목이 아니다」는 다른 말입니다.
    // 같은 문구로 답하면 담당자가 옵션을 다시 넣으려고 헤맵니다.
    const hasAny = enrollments.length > 0 || (enrollRes.data as unknown[] | null)?.length;
    return NextResponse.json(
      {
        error:
          planIds && planIds.length > 0 && hasAny
            ? "이 학생에게는 고른 항목의 납부 옵션이 없습니다(다른 항목만 신청되어 있습니다)."
            : "이 학생이 고른 납부 옵션이 없습니다. 학비 청구 화면에서 먼저 골라주세요.",
      },
      { status: 400 },
    );
  }

  // 이 청구서가 무엇을 담았는지를 **사람이 읽는 이름으로** 굳혀 적습니다. 항목 id 로만
  // 가리키면 나중에 요금표에서 항목 이름이 바뀌거나 항목을 껐을 때, 지난 청구서가 무슨
  // 청구서였는지 설명할 수 없게 됩니다.
  const planScope = planIds && planIds.length > 0 ? lines.map((l) => l.label.split(" · ")[0]).join(" · ") : null;

  const total = lines.reduce((n, l) => n + l.amount, 0);
  // 이미 받은 건은 **받은 날**이 발행일입니다. 오늘로 적으면 지난달 수납이 이번 달로
  // 세어져, 월별 수납 집계가 통째로 어긋납니다.
  const issue = paidAt ?? todayKst();
  const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : issue;

  const recipient = resolveRecipient(
    { mother_phone: student.mother_phone ?? null, father_phone: student.father_phone ?? null, parent_phone: student.parent_phone ?? null },
    guardianRole,
  );

  // 지난 학비 미납을 이 청구서에 얹습니다(학비 갈래만). 교복·교재 미납은 섞지 않습니다 -
  // 학부모가 무슨 돈인지 모르고, 이 달 학비가 얼마 걷혔는지도 셀 수 없게 됩니다.
  //
  // **항목을 골라 발행할 때는 이월을 얹지 않습니다.** 방과후 청구서에 지난 정규과정
  // 미납이 붙으면 학부모는 무슨 돈인지 모르고, 우리도 「방과후가 얼마 걷혔나」를 셀 수
  // 없게 됩니다. 이월은 학비 전부를 담은 청구서가 짊어집니다.
  const carry =
    planIds && planIds.length > 0
      ? { total: 0, lines: [] as { seq: number; name: string; qty: number; unit_price: number; amount: number }[], lockIds: [] as string[], error: null as string | null }
      : await planCarryForward(supabase, { studentId: student.id, stream: "학비", today: todayKst() });
  if (carry.error) return NextResponse.json({ error: `지난 미납을 읽지 못했습니다: ${carry.error}` }, { status: 500 });

  // 번호는 DB가 정합니다. 사람이 손으로 붙이면 반드시 겹칩니다.
  const { data: noRow, error: noErr } = await supabase.rpc("next_invoice_no");
  if (noErr) return NextResponse.json({ error: `번호를 만들지 못했습니다: ${noErr.message}` }, { status: 500 });

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      invoice_no: noRow as unknown as string,
      stream: "학비",
      student_id: student.id,
      student_name: student.name_en?.trim() || student.name,
      student_name_ko: student.name,
      grade_label: gradeLabel({ grade: student.grade, className: student.class_name }),
      issue_date: issue,
      due_date: due,
      total_amount: total + carry.total,
      guardian_phone: recipient?.phone ?? null,
      guardian_role: recipient?.role ?? null,
      // 학비 청구서는 학비외와 **한 장에 섞지 않습니다.** 금액 자릿수가 다르고 납기도
      // 다릅니다. 분류로 갈라두면 명단에서도 따로 셉니다.
      category: "학비",
      // 학기 칸은 학비외 청구서와 **같은 칸**을 씁니다. 두 종류가 다른 칸에 학기를 넣으면
      // 학기별 집계가 한쪽만 세게 됩니다.
      term_id: termId,
      plan_scope: planScope,
      // 소급해 만든 청구서는 학부모에게 보내지 않습니다 - 보내면 «이미 낸 돈을 또 내라»가
      // 됩니다. 화면이 보낼 것과 안 보낼 것을 이 값으로 가릅니다.
      issued_offline: !!paidAt,
      issued_by: me.name || me.email,
    })
    .select()
    .single();
  if (invErr || !inv) return NextResponse.json({ error: invErr?.message ?? "발행 실패" }, { status: 500 });

  // 할인을 **별도 줄로** 남깁니다. 깎인 금액만 적으면 학부모가 「원래 얼마였는데 얼마
  // 깎였는지」를 알 수 없고, 그 문의가 그대로 행정실로 옵니다.
  const rows: { invoice_id: string; seq: number; name: string; qty: number; unit_price: number; amount: number }[] = [];
  let seq = 0;
  for (const l of lines) {
    rows.push({ invoice_id: inv.id, seq: ++seq, name: l.label, qty: 1, unit_price: l.subtotal, amount: l.subtotal });
    for (const d of l.discounts) {
      rows.push({ invoice_id: inv.id, seq: ++seq, name: `　└ ${d.name}`, qty: 1, unit_price: -d.amount, amount: -d.amount });
    }
  }

  // 이월 줄은 맨 아래. 이번에 새로 청구하는 것이 먼저 읽혀야 합니다.
  for (const c of carry.lines) rows.push({ invoice_id: inv.id, seq: ++seq, ...c });

  const { error: lineErr } = await supabase.from("invoice_lines").insert(rows);
  // 줄을 못 넣었으면 총액만 있고 내역이 없는 종이가 나갑니다. 머리줄을 지우고 실패로 답합니다.
  if (lineErr) {
    // 되돌리기도 실패할 수 있습니다. 그러면 **총액만 있고 내역이 없는 청구서**가 남는데,
    // 화면에는 정상으로 보여서 그대로 학부모에게 나갑니다. 되돌리기 실패는 원래 오류보다
    // 더 나쁜 상태이므로 반드시 사람에게 알립니다.
    const { error: rollbackErr } = await supabase.from("invoices").delete().eq("id", inv.id);
    return NextResponse.json(
      {
        error: rollbackErr
          ? `내역을 저장하지 못했고(${lineErr.message}) 빈 청구서도 지우지 못했습니다(${rollbackErr.message}). 청구서 ${inv.invoice_no ?? inv.id} 를 직접 확인해주세요.`
          : `내역을 저장하지 못했습니다: ${lineErr.message}`,
      },
      { status: 500 },
    );
  }

  const lockErr = await lockCarried(supabase, carry.lockIds, inv.id as string);
  if (lockErr) {
    return NextResponse.json(
      { error: `청구서는 만들었지만 지난 미납을 잠그지 못했습니다(${lockErr}). 같은 돈이 두 번 청구될 수 있으니 확인해주세요.` },
      { status: 500 },
    );
  }

  // ── 이미 받은 돈 기록 ────────────────────────────────────────────────
  //
  // 금액을 안 주면 **청구액 전부**를 받은 것으로 봅니다. 대개 그렇고, 다르면 화면에서
  // 금액을 적어 보냅니다.
  let paidRecorded = 0;
  if (paidAt) {
    const amount = Number(alreadyPaid?.amount) > 0 ? Number(alreadyPaid?.amount) : total + carry.total;
    const { error: payErr } = await supabase.from("payments").insert({
      invoice_id: inv.id,
      student_id: student.id,
      paid_at: paidAt,
      amount,
      method: (alreadyPaid?.method ?? "").trim() || "계좌이체",
      payer_name: student.name,
      memo: (alreadyPaid?.memo ?? "").trim() || "이미 받은 건을 소급 등록",
      source: "수기",
      matched_by: "이미받음",
      created_by: me.email,
    });
    // 청구서는 만들어졌는데 입금이 안 붙으면 **미납으로 남습니다.** 이미 낸 분에게 독촉이
    // 나가는 자리라, 조용히 넘기지 않고 그대로 알립니다.
    if (payErr) {
      return NextResponse.json(
        { error: `청구서(${inv.invoice_no})는 만들었지만 입금을 기록하지 못했습니다: ${payErr.message}. 수납 화면에서 직접 넣어주세요.` },
        { status: 500 },
      );
    }
    paidRecorded = amount;
  }

  // ── 남은 선입금 충당 ────────────────────────────────────────────────
  //
  // 먼저 받아둔 돈이 있는데 이 청구서가 「미납」으로 뜨면 이미 낸 분에게 독촉이 나갑니다.
  const pre = paidAt ? { applied: 0, error: null } : await applyPrepaid(supabase, inv, me.email);

  return NextResponse.json({
    ok: true,
    invoice: inv,
    carried: carry.total,
    paid: paidRecorded,
    prepaidApplied: pre.applied,
    // 붙이다 실패해도 청구서는 그대로 둡니다. 지우면 방금 만든 종이가 사라지고, 그냥
    // 넘어가면 이미 받은 돈이 미납으로 남습니다. 사실만 올려 사람이 보게 합니다.
    warning: pre.error,
  });
}
