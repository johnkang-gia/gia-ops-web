import { NextResponse } from "next/server";
import { invoiceCoversPlan, billRuleOf } from "@/lib/tuitionMonth";
import { resolveAddon, addonPlanForLine, type AddonPrice } from "@/lib/tuitionAddon";
import { planCarryForward, lockCarried } from "@/lib/carryForward";
import { applyPrepaid } from "@/lib/prepaidApply";

import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { gradeLabel, inTerm, resolveStudentItems } from "@/lib/feeItems";
import { addDays, DUE_DAYS } from "@/lib/financePeriod";
import { todayKst } from "@/lib/kst";
import { resolveRecipient, type GuardianRole, phonesOf, chosenRoleOf, type StudentBilling } from "@/lib/alltalkpay";
import { streamOf } from "@/lib/settlement";
import { discountsForPlan, invoiceRowsForLine, tuitionLine, type TuitionLine } from "@/lib/tuition";
import type { FeePlan, FeePaymentOption, FeeDiscount, FeeItem, StudentFeeItem } from "@/lib/types";
import { loadStudentsWithPhones } from "@/lib/students";

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
  /** 학생별 결제번호. 이 아이의 청구서가 나갈 번호를 정해 둔 값입니다. */
  billing_phone_role?: string | null; billing_phone?: string | null;
};

/**
 * 명부 줄에서 **결제번호 판정에 쓰는 칸만** 꺼냅니다.
 *
 * 칸이 아직 없는 DB(마이그레이션 전)에서도 발행 자체는 되어야 하므로 undefined 를 null 로
 * 눕힙니다 - 여기서 막으면 청구가 통째로 멈춥니다.
 */
function billingOf(s: StudentRow): StudentBilling {
  return {
    billing_phone_role: s.billing_phone_role ?? null,
    billing_phone: s.billing_phone ?? null,
    mother_phone: s.mother_phone ?? null,
    father_phone: s.father_phone ?? null,
    parent_phone: s.parent_phone ?? null,
  };
}

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
  /**
   * **학비외 항목을 같은 장에 담을 때.** 학비와 학비외는 원래 두 장입니다(금액 자릿수·납기가 다름).
   * 그러나 학부모 한 분께 같은 날 두 장을 보내면 「왜 두 번이냐」가 돌아오므로, 화면이 고르면
   * 한 장으로 묶습니다. 담긴 학비외 줄은 `item_id` 로 남아 「그 항목이 이미 나갔는가」 판정이
   * 그대로 됩니다. 장의 갈래(`stream`)는 학비입니다 - 월별 집계에서 학비로 셉니다.
   */
  const itemIds = Array.isArray(body?.itemIds) ? (body.itemIds as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const alreadyPaid = body?.alreadyPaid as { paidAt?: string; amount?: number; method?: string; memo?: string } | undefined;
  const paidAt = typeof alreadyPaid?.paidAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(alreadyPaid.paidAt) ? alreadyPaid.paidAt : null;
  const askedRole = body?.guardianRole;
  const guardianRole: GuardianRole | null =
    askedRole === "mother" || askedRole === "father" || askedRole === "guardian" ? askedRole : null;
  if (!studentId) return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();

  const [stuRes, planRes, optRes, enrollRes, sdRes, discRes, addonRes] = await Promise.all([
    // 퇴소한 아이에게도 발행할 수 있어야 합니다(미납 정산). 보호자 번호는 청구서에 찍힙니다.
    loadStudentsWithPhones(supabase, { ids: [studentId], status: "all" }),
    supabase.from("fee_plans").select("*").eq("category", "학비"),
    supabase.from("fee_payment_options").select("*"),
    // 학기를 안 건 옛 줄도 함께 봅니다. 학기가 생기기 전에 넣어둔 신청이 있고, 그걸 빼면
    // 그 학생만 조용히 청구에서 빠집니다.
    supabase.from("student_fee_enrollments").select("*").eq("student_id", studentId).eq("active", true),
    supabase.from("student_fee_discounts").select("*").eq("student_id", studentId).eq("active", true),
    supabase.from("fee_discounts").select("*"),
    // 함께 하면 합친 금액이 정해진 프로그램(오케스트라). 화면과 같은 표·같은 함수로 셉니다.
    supabase.from("fee_addon_prices").select("addon_plan_id, base_plan_id, combined_amount, active"),
  ]);
  if (stuRes.error) return NextResponse.json({ error: stuRes.error }, { status: 500 });
  const err = planRes.error ?? optRes.error ?? enrollRes.error ?? sdRes.error ?? discRes.error ?? addonRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const student = (stuRes.rows[0] as StudentRow | undefined) ?? null;
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });

  const plans = (planRes.data as FeePlan[] | null) ?? [];
  const options = (optRes.data as FeePaymentOption[] | null) ?? [];
  const discounts = (discRes.data as FeeDiscount[] | null) ?? [];

  const sameTerm = <T extends { term_id?: string | null }>(r: T) => !r.term_id || !termId || r.term_id === termId;

  const enrollments = ((enrollRes.data as {
    plan_id: string;
    option_id: string | null;
    term_id: string | null;
    override_amount: number | null;
    override_note: string | null;
  }[] | null) ?? [])
    .filter(sameTerm)
    .filter((e) => !planIds || planIds.length === 0 || planIds.includes(e.plan_id));
  // 이 학생에게 붙은 할인 줄. **끈 할인도 그대로 씁니다** - 이미 붙어 있던 건을 빼면
  // 학부모가 들은 금액과 청구서가 달라집니다. 새로 붙이는 것만 화면에서 막습니다.
  const studentDiscounts =
    (sdRes.data as { discount_id: string; term_id: string | null; plan_id: string | null }[] | null) ?? [];

  // 함께 하는 프로그램이 짝을 찾는 범위 - **이번에 담는 항목만이 아니라** 이 학기에 고른 학비 전부입니다.
  // 오케스트라만 따로 발행해도 방과후 5일반을 하고 있으면 그 조합 금액이어야 합니다.
  const addonPrices = (addonRes.data as AddonPrice[] | null) ?? [];
  const chosenPlanIds = ((enrollRes.data as { plan_id: string; option_id: string | null; term_id: string | null; override_amount: number | null }[] | null) ?? [])
    .filter(sameTerm)
    .filter((e) => e.option_id || (e.override_amount !== null && e.override_amount !== undefined))
    .map((e) => e.plan_id);

  const lines: TuitionLine[] = [];
  /**
   * 줄마다 어느 항목(fee_plans)인가. 청구서 줄에 **항목 번호를 남깁니다**(`invoice_lines.plan_id`).
   *
   * 예전에는 학비 줄에 번호가 없어 「이미 나간 항목인가」를 이름 글자와 `plan_scope` 글자로만 가렸습니다.
   * 직접 기입 줄은 이름이 「정규과정 · 직접 기입」이라 글자로는 못 찾았고, 데이터베이스 문지기도 걸 수 없었습니다.
   */
  const planIdOfLine = new Map<TuitionLine, string>();
  for (const e of enrollments) {
    const plan = plans.find((p) => p.id === e.plan_id);
    if (!plan) continue;
    const option = options.find((o) => o.id === e.option_id) ?? null;
    // 항목에 딱 걸린 할인 + 학비 전체에 걸린 할인. 고르는 일은 화면과 **같은 함수**가
    // 합니다 - 각자 거르면 표에 뜬 금액과 청구서 금액이 달라집니다.
    const forPlan = discountsForPlan(studentDiscounts, discounts, plan.id, termId);
    // 사람이 직접 정한 금액이 있으면 그것이 청구액입니다(교장님 상담 등). 화면과 같은
    // 함수가 정합니다 - 서버가 따로 계산하면 표에 뜬 금액과 청구서가 달라집니다.
    const addon = resolveAddon(plan, addonPrices, plans, chosenPlanIds);
    const line = tuitionLine(addonPlanForLine(plan, addon), option, forPlan, {
      amount: e.override_amount === null || e.override_amount === undefined ? null : Number(e.override_amount),
      note: e.override_note,
    });
    if (line) {
      lines.push(line);
      planIdOfLine.set(line, plan.id);
    }
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

  // ── 같은 장에 담을 학비외 ───────────────────────────────────────────────
  type ExtraLine = { name: string; item_id: string; qty: number; unit_price: number; amount: number };
  const extraLines: ExtraLine[] = [];
  if (itemIds.length > 0) {
    const [itemsRes, ovRes, termRes] = await Promise.all([
      supabase.from("fee_items").select("*"),
      supabase.from("student_fee_items").select("*").eq("student_id", studentId),
      termId ? supabase.from("terms").select("status").eq("id", termId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
    if (ovRes.error) return NextResponse.json({ error: ovRes.error.message }, { status: 500 });
    const termIsCurrent = (termRes.data as { status?: string } | null)?.status === "진행중";
    const resolved = resolveStudentItems(
      ((itemsRes.data as FeeItem[] | null) ?? []).filter((i) => inTerm(i, termId ?? "", termIsCurrent)),
      { id: student.id, grade: student.grade, className: student.class_name, department: student.department },
      (ovRes.data as StudentFeeItem[] | null) ?? [],
    ).filter((l) => itemIds.includes(l.item.id));
    if (resolved.length !== itemIds.length) {
      return NextResponse.json({ error: "고른 학비외 항목 중 이 학생에게 붙어 있지 않은 것이 있습니다. 표에서 다시 확인해주세요." }, { status: 400 });
    }
    // 같은 항목을 두 번 담지 않습니다 - 학비외 창구와 같은 규칙(살아 있는 청구서의 같은 항목 번호).
    const { data: aliveInv } = await supabase.from("invoices").select("id, invoice_no, term_id").eq("student_id", student.id).eq("status", "발행").is("carried_to_invoice_id", null);
    const sameTermInv = (aliveInv ?? []).filter((v) => !termId || !v.term_id || v.term_id === termId);
    if (sameTermInv.length > 0) {
      const { data: dup } = await supabase.from("invoice_lines").select("invoice_id, name").in("invoice_id", sameTermInv.map((v) => v.id)).in("item_id", itemIds);
      if (dup && dup.length > 0) {
        const noOf = new Map(sameTermInv.map((v) => [v.id, v.invoice_no]));
        return NextResponse.json(
          { error: `이미 청구서에 담긴 항목입니다: ${dup.map((d) => `${d.name}(${noOf.get(d.invoice_id) ?? ""})`).join(", ")}. 그 장을 취소한 뒤 다시 만들어주세요.` },
          { status: 409 },
        );
      }
    }
    for (const l of resolved) extraLines.push({ name: l.item.name, item_id: l.item.id, qty: l.qty, unit_price: Number(l.item.unit_price), amount: l.amount });
  }
  const extraTotal = extraLines.reduce((n, l) => n + l.amount, 0);

  const tuitionOnlyTotal = lines.reduce((n, l) => n + l.amount, 0) + extraTotal;
  // 이미 받은 건은 **받은 날**이 발행일입니다. 오늘로 적으면 지난달 수납이 이번 달로
  // 세어져, 월별 수납 집계가 통째로 어긋납니다.
  const issue = paidAt ?? todayKst();
  // 화면이 기한을 안 보냈으면 **발행일 + 이레**입니다. 앞 판은 발행일 그대로였는데,
  // 그러면 학부모가 문자를 받는 순간 이미 마감일이고 다음 날 전부 연체가 됩니다 -
  // 연체 표시가 온통 빨개지면 정작 진짜 밀린 건이 묻힙니다.
  const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : addDays(issue, DUE_DAYS);
  /**
   * 청구월(YYYY-MM). 안 주면 발행일의 월입니다.
   *
   * 서식이 어긋난 값은 **받지 않고 발행일로 눕힙니다** - 여기서 거절하면 청구가 통째로
   * 멈추고, 그대로 넣으면 데이터베이스의 검사에 걸려 같은 결과가 됩니다.
   */
  const rawMonth = String((body as { billingMonth?: unknown } | null)?.billingMonth ?? "").trim();
  const billingMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : null;

  const recipient = resolveRecipient(
    // 판정은 @/lib/alltalkpay 한 곳에서. 학생별 결제번호가 기본이고, 이번 건만 다르게
    // 고른 것이 있으면 그것이 이깁니다.
    phonesOf(billingOf(student)),
    guardianRole ?? chosenRoleOf(billingOf(student)),
  );

  // 지난 학비 미납을 이 청구서에 얹습니다(학비 갈래만). 교복·교재 미납은 섞지 않습니다 -
  // 학부모가 무슨 돈인지 모르고, 이 달 학비가 얼마 걷혔는지도 셀 수 없게 됩니다.
  //
  // **항목을 골라 발행할 때는 이월을 얹지 않습니다.** 방과후 청구서에 지난 정규과정
  // 미납이 붙으면 학부모는 무슨 돈인지 모르고, 우리도 「방과후가 얼마 걷혔나」를 셀 수
  // 없게 됩니다. 이월은 학비 전부를 담은 청구서가 짊어집니다.
  // ── **미납은 저절로 얹히지 않습니다.** ──────────────────────────────────────
  //
  // 앞 판은 발행할 때마다 지난 미납을 자동으로 합쳤습니다. 학부모가 한 장만 보면 되니 좋아
  // 보였고, 그 코드의 주석은 「금액이 눈덩이처럼 불어납니다」라고 적혀 있었습니다 - 버그가
  // 아니라 **설계대로 동작한 결과**였습니다.
  //
  // 8~9월 실측에서 200만원을 넘긴 청구서는 **한 건도 안 걷혔습니다**(7건 3,190만원). 1,081만원
  // 짜리 한 장은 아무도 못 내고, 「미납인보이스 정산」이라고만 적혀 있어 무슨 돈인지도
  // 모릅니다.
  //
  // 이제 합치는 것은 **사람이 미납금 화면에서 고릅니다**(`/finance/unpaid`). 여기서는
  // 화면이 일부러 `carryForward: true` 를 보낼 때만 얹습니다.
  const wantCarry = (body as { carryForward?: unknown } | null)?.carryForward === true;
  const carry =
    !wantCarry || (planIds && planIds.length > 0)
      ? { total: 0, lines: [] as { seq: number; name: string; qty: number; unit_price: number; amount: number }[], lockIds: [] as string[], error: null as string | null }
      : await planCarryForward(supabase, { studentId: student.id, stream: "학비", today: todayKst() });
  if (carry.error) return NextResponse.json({ error: `지난 미납을 읽지 못했습니다: ${carry.error}` }, { status: 500 });

  // ── 다음 달에 얹기로 적어 둔 차액 ──────────────────────────────────────────
  //
  // 지난 장을 보낸 뒤 금액이 바뀐 경우(더 받기·덜 받기). 보고 있는 달 이전·이 달로 적힌 것만 얹고,
  // 항목을 골라 발행할 때는 **그 항목의 차액과 항목 없는 차액**만 얹습니다. 이미 받은 돈을 소급해
  // 넣는 장(alreadyPaid)에는 얹지 않습니다 - 그 장은 과거의 사실이지 새 청구가 아닙니다.
  type ExtraCharge = { id: string; plan_id: string | null; name: string; amount: number | string; reason: string; target_month: string | null };
  let extraCharges: ExtraCharge[] = [];
  if (!paidAt) {
    const monthKey = billingMonth ?? issue.slice(0, 7);
    const { data: ecRows, error: ecErr } = await supabase
      .from("tuition_extra_charges")
      .select("id, plan_id, name, amount, reason, target_month, term_id")
      .eq("student_id", student.id)
      .is("invoice_id", null)
      .is("cancelled_at", null);
    if (ecErr) return NextResponse.json({ error: `다음 달 차액을 읽지 못해 발행하지 않았습니다: ${ecErr.message}` }, { status: 500 });
    extraCharges = ((ecRows as (ExtraCharge & { term_id: string | null })[] | null) ?? [])
      .filter((c) => !c.term_id || !termId || c.term_id === termId)
      .filter((c) => !c.target_month || c.target_month <= monthKey)
      .filter((c) => !planIds || planIds.length === 0 || !c.plan_id || planIds.includes(c.plan_id));
  }
  const extraChargeTotal = extraCharges.reduce((n, c) => n + Math.round(Number(c.amount)), 0);
  const total = tuitionOnlyTotal + extraChargeTotal;
  if (total < 0) {
    return NextResponse.json({ error: `차액(감액 ${extraChargeTotal.toLocaleString()}원)이 이번 달 청구액보다 커서 마이너스 청구서가 됩니다. 감액을 줄이거나 환불로 처리해주세요.` }, { status: 400 });
  }

  /**
   * **찍을 줄의 합 = 청구액** 인지 넣기 전에 확인합니다.
   *
   * 데이터베이스는 청구서 합계를 줄의 합으로 다시 셉니다(§2-12). 그래서 줄이 틀리면 합계도
   * 조용히 따라 틀리고, 학부모는 그 금액으로 결제합니다. 직접 기입이 계산값보다 클 때 늘어난
   * 만큼이 줄에서 빠져 437,500원이 325,000원으로 나간 일이 있었습니다. 어긋나면 **발행하지
   * 않고** 이유를 돌려줍니다 - 틀린 청구서가 나가는 것보다 안 나가는 편이 낫습니다.
   */
  // 각 항목의 첫 줄(원래 금액·직접 기입 금액)에만 번호를 붙입니다. 할인·조정 줄은 그 항목에 딸린 줄입니다.
  const tuitionRows = lines.flatMap((l) =>
    invoiceRowsForLine(l).map((r, i) => ({ ...r, planId: i === 0 ? (planIdOfLine.get(l) ?? null) : null })),
  );
  const rowsTotal = tuitionRows.reduce((n, r) => n + r.amount, 0) + extraTotal + extraChargeTotal;
  if (rowsTotal !== total) {
    console.error("[학비 청구] 줄의 합과 청구액이 다릅니다", { student: student.id, rowsTotal, total });
    return NextResponse.json(
      { error: `청구서 줄의 합(${rowsTotal.toLocaleString()}원)이 청구액(${total.toLocaleString()}원)과 달라 발행하지 않았습니다. 개발자에게 알려주세요.` },
      { status: 500 },
    );
  }

  /**
   * **같은 달에 같은 항목이 이미 「발행」 상태면 만들지 않습니다 — 범위 글자가 아니라 항목으로 견줍니다.**
   *
   * 데이터베이스의 유일 인덱스(`invoices_tuition_scope_month_uniq`)는 `plan_scope` **글자**가 같을
   * 때만 막습니다. 「전부」(빈 칸)로 낸 장과 「정규과정 · 방과후 3일반 · …」으로 낸 장은 같은
   * 항목인데 글자가 달라 둘 다 들어갔습니다 - 최서연 10월분이 학비+학비외 한 장(2026-0352)과 학비
   * 한 장(2026-0353)으로 두 번 「발행」 상태가 됐습니다. 학부모는 둘 다 받으면 둘 다 냅니다.
   *
   * 빈 범위는 «그 달 학비 전부»라서 무엇과도 겹칩니다.
   */
  {
    const month = billingMonth ?? issue.slice(0, 7);
    const mine = new Set(lines.map((l) => l.planName));
    const { data: live, error: liveErr } = await supabase
      .from("invoices")
      .select("id, invoice_no, plan_scope, stream, category, term_id, issue_date, issued_by")
      .eq("student_id", student.id)
      .eq("status", "발행")
      .eq("billing_month", month)
      .is("carried_to_invoice_id", null);
    if (liveErr) return NextResponse.json({ error: `이미 낸 청구서를 확인하지 못해 발행하지 않았습니다: ${liveErr.message}` }, { status: 500 });
    type LiveInv = {
      id: string;
      invoice_no: string | null;
      plan_scope: string | null;
      stream: string | null;
      category: string | null;
      term_id: string | null;
      issue_date: string | null;
      issued_by: string | null;
    };
    const liveList = ((live as LiveInv[] | null) ?? []).filter((v) => streamOf(v) === "학비" && (v.term_id ?? null) === (termId ?? null));
    // 범위 글자가 아니라 **담긴 줄**로 견줍니다(화면과 같은 함수 `invoiceCoversPlan`). 범위를 안 적고 나간
    // 30만 한 줄짜리 장이 「학비 전부」로 읽혀, 정규과정을 한 번도 안 낸 학생에게 발행이 막혔습니다.
    const liveLines = new Map<string, { name: string; plan_id: string | null }[]>();
    if (liveList.length > 0) {
      const { data: ls, error: lsErr } = await supabase
        .from("invoice_lines")
        .select("invoice_id, name, plan_id")
        .in("invoice_id", liveList.map((v) => v.id));
      if (lsErr) return NextResponse.json({ error: `이미 낸 청구서의 줄을 확인하지 못해 발행하지 않았습니다: ${lsErr.message}` }, { status: 500 });
      for (const l of (ls as { invoice_id: string; name: string; plan_id: string | null }[] | null) ?? []) {
        const cur = liveLines.get(l.invoice_id);
        if (cur) cur.push(l);
        else liveLines.set(l.invoice_id, [l]);
      }
    }
    const planIdByName = new Map<string, string>();
    for (const l of lines) {
      const id = planIdOfLine.get(l);
      if (id) planIdByName.set(l.planName, id);
    }
    const clash = liveList
      .map((v) => {
        const withLines = { plan_scope: v.plan_scope, lines: liveLines.get(v.id) ?? [] };
        const shared = [...mine].filter((n) => invoiceCoversPlan(withLines, { id: planIdByName.get(n) ?? null, name: n }));
        return { no: v.invoice_no, shared, date: v.issue_date, by: v.issued_by };
      })
      .filter((c) => c.shared.length > 0);
    if (clash.length > 0) {
      // **언제·누가 낸 몇 번인지** 함께 말합니다. 「이미 발행되었습니다」만으로는 어디서 그 장을
      // 찾아야 하는지 알 수 없었습니다.
      const desc = clash
        .map((c) => `${c.no ?? "번호 없음"} — ${c.date ?? "날짜 없음"}${c.by ? ` ${c.by}` : ""} 발행 (${c.shared.join(", ")})`)
        .join(" · ");
      return NextResponse.json(
        {
          error: `${month} 학비가 이미 발행되어 있습니다: ${desc}. 같은 항목을 두 번 청구하지 않습니다 - 학생별 회계에서 그 청구서를 취소한 뒤 다시 발행해주세요.`,
          clash: clash.map((c) => ({ invoiceNo: c.no, issueDate: c.date, issuedBy: c.by, items: c.shared })),
        },
        { status: 409 },
      );
    }
  }

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
      // **몇 월치인가.** 화면이 안 주면 발행일의 월을 씁니다 - 지금까지 그렇게 세어 왔으니
      // 그 값이 지금의 참입니다. 9월분을 8월 말에 미리 보내는 경우에만 화면이 따로 고릅니다.
      billing_month: billingMonth ?? issue.slice(0, 7),
      due_date: due,
      total_amount: total + carry.total,
      guardian_phone: recipient?.phone ?? null,
      guardian_role: recipient?.role ?? null,
      // 학비 청구서는 학비외와 **한 장에 섞지 않습니다.** 금액 자릿수가 다르고 납기도
      // 다릅니다. 분류로 갈라두면 명단에서도 따로 셉니다.
      category: extraLines.length > 0 ? "학비+학비외" : "학비",
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
  if (invErr || !inv) {
    // 23505 = 같은 학생·학기·청구월·항목 범위의 학비 청구서가 이미 「발행」 상태입니다
    // (`invoices_tuition_scope_month_uniq`). 두 탭에서 눌렀거나 어제 누른 것을 잊은 경우입니다.
    // 데이터베이스 메시지를 그대로 보여주면 사람은 무엇을 해야 하는지 모릅니다.
    if (invErr?.code === "23505") {
      return NextResponse.json(
        { error: `${planScope ?? "학비 전부"} 청구서가 이 달에 이미 있습니다. 같은 항목을 두 번 발행하지 않습니다 - 그 장을 취소한 뒤 다시 만들어주세요.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: invErr?.message ?? "발행 실패" }, { status: 500 });
  }

  // 할인을 **별도 줄로** 남깁니다. 깎인 금액만 적으면 학부모가 「원래 얼마였는데 얼마
  // 깎였는지」를 알 수 없고, 그 문의가 그대로 행정실로 옵니다.
  const rows: { invoice_id: string; seq: number; name: string; qty: number; unit_price: number; amount: number; plan_id?: string | null }[] = [];
  let seq = 0;
  // 원래 금액 · 할인 · (직접 기입이면) 조정 줄 - 더하면 화면에 뜬 금액입니다(invoiceRowsForLine).
  for (const r of tuitionRows) {
    rows.push({ invoice_id: inv.id, seq: ++seq, name: r.name, qty: 1, unit_price: r.amount, amount: r.amount, plan_id: r.planId });
  }

  // 같은 장에 담은 학비외 줄. 항목 번호를 함께 남겨 「이미 나갔는가」 판정이 됩니다.
  const extraRows: (typeof rows[number] & { item_id: string })[] = extraLines.map((l) => ({ invoice_id: inv.id, seq: ++seq, name: l.name, item_id: l.item_id, qty: l.qty, unit_price: l.unit_price, amount: l.amount }));

  // 다음 달에 얹기로 한 차액. 정정 줄(`is_adjustment`)로 넣어 중복 문지기를 지나고, 사유가 종이에 남습니다.
  const chargeRows = extraCharges.map((c) => ({
    invoice_id: inv.id,
    seq: ++seq,
    name: c.name,
    qty: 1,
    unit_price: Math.round(Number(c.amount)),
    amount: Math.round(Number(c.amount)),
    plan_id: null as string | null,
    is_adjustment: true,
    adjust_reason: c.reason,
  }));

  // 이월 줄은 맨 아래. 이번에 새로 청구하는 것이 먼저 읽혀야 합니다.
  for (const c of carry.lines) rows.push({ invoice_id: inv.id, seq: ++seq, ...c });

  const { error: lineErr } = await supabase.from("invoice_lines").insert([...rows, ...extraRows, ...chargeRows]);
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
      // 23505 = 데이터베이스 중복 문지기(guard_invoice_line_duplicate)가 막은 것 - «이미 나간 항목»입니다.
      { status: lineErr.code === "23505" ? 409 : 500 },
    );
  }

  // ── 여러 달 묶음 납부의 시작월 ──────────────────────────────────────────
  //
  // 5개월·10개월 납부를 운영앱에서 처음 청구하면 **그 청구월이 시작월**입니다. 적어두지 않으면
  // 다음 달 화면에서 이 항목이 다시 「미청구」로 떠 같은 돈을 또 청구하게 됩니다. 사람이 이미
  // 적은 시작월(운영앱 이전 납부)은 건드리지 않습니다. 못 적어도 청구서는 이미 나갔으므로
  // 실패로 돌리지 않고 경고로 알립니다 - 청구서 청구월에서 같은 기간을 셀 수 있습니다.
  const startMonth = (inv as { billing_month?: string | null }).billing_month ?? issue.slice(0, 7);
  const spanWarnings: string[] = [];
  for (const e of (enrollRes.data as { id: string; plan_id: string; option_id: string | null; term_id: string | null; paid_from?: string | null }[] | null) ?? []) {
    if (e.paid_from || !e.option_id) continue;
    if (!sameTerm(e) || (planIds && planIds.length > 0 && !planIds.includes(e.plan_id))) continue;
    const plan = plans.find((p) => p.id === e.plan_id);
    const opt = options.find((o) => o.id === e.option_id);
    if (!plan || !opt || billRuleOf(plan, opt).rule !== "기간") continue;
    const { error: pfErr } = await supabase.from("student_fee_enrollments").update({ paid_from: startMonth }).eq("id", e.id);
    if (pfErr) spanWarnings.push(`${plan.name} 시작월을 적지 못했습니다(${pfErr.message})`);
  }

  // 얹힌 차액에 어느 장인지 적습니다. 못 적으면 다음 발행에 **또 얹히므로** 실패로 돌립니다.
  if (extraCharges.length > 0) {
    const { error: ecMarkErr } = await supabase
      .from("tuition_extra_charges")
      .update({ invoice_id: inv.id, billed_at: new Date().toISOString() })
      .in("id", extraCharges.map((c) => c.id));
    if (ecMarkErr) {
      return NextResponse.json(
        { error: `청구서는 만들었지만 얹은 차액에 표시를 못 했습니다(${ecMarkErr.message}). 같은 차액이 다음 장에 또 붙을 수 있으니 확인해주세요.` },
        { status: 500 },
      );
    }
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
      origin: "이미받음",
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
  // 금전 창처럼 **사람이 그 자리에서 뺄 항목을 고르는 곳**은 `skipPrepaid` 를 보냅니다. 저절로
  // 빼고 나서 다시 고르게 하면 같은 돈이 두 번 오갑니다.
  const pre = paidAt || body?.skipPrepaid === true ? { applied: 0, error: null } : await applyPrepaid(supabase, inv, me.email);

  return NextResponse.json({
    ok: true,
    invoice: inv,
    carried: carry.total,
    paid: paidRecorded,
    prepaidApplied: pre.applied,
    // 붙이다 실패해도 청구서는 그대로 둡니다. 지우면 방금 만든 종이가 사라지고, 그냥
    // 넘어가면 이미 받은 돈이 미납으로 남습니다. 사실만 올려 사람이 보게 합니다.
    warning: [pre.error, ...spanWarnings].filter(Boolean).join(" / ") || null,
  });
}
