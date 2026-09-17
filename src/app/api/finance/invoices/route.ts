import { NextResponse } from "next/server";
import { applyPrepaid } from "@/lib/prepaidApply";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { gradeLabel, inTerm, resolveStudentItems } from "@/lib/feeItems";
import { selectTolerant } from "@/lib/selectTolerant";
import { addDays, DUE_DAYS } from "@/lib/financePeriod";
import { todayKst } from "@/lib/kst";
import { planCarryForward, lockCarried } from "@/lib/carryForward";
import { resolveRecipient, type GuardianRole, phonesOf, chosenRoleOf, type StudentBilling } from "@/lib/alltalkpay";
import type { FeeItem, StudentFeeItem } from "@/lib/types";

// 인보이스 발행.
//
// **금액은 서버가 계산합니다.** 화면이 보낸 총액을 그대로 믿으면, 화면이 틀렸을 때 틀린
// 금액이 그대로 학부모에게 갑니다. 화면과 서버가 같은 함수(resolveStudentItems)를 쓰되,
// 최종 값은 여기서 다시 냅니다.
//
// 그리고 **그 순간의 이름과 금액을 베껴 굳힙니다.** 항목 표를 참조만 하면, 나중에 책값이
// 오를 때 이미 보낸 인보이스의 금액까지 같이 바뀝니다. 학부모가 받은 종이와 화면이
// 달라지는 것입니다.

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
  // 청구 대상을 화면에서 미리 고를 수 있습니다. 안 고르면 어머니 → 아버지 → 보호자 순입니다.
  const askedRole = body?.guardianRole;
  const guardianRole: GuardianRole | null =
    askedRole === "mother" || askedRole === "father" || askedRole === "guardian" ? askedRole : null;
  // 학기 칸 이름은 `term_id` 입니다. 예전에는 재무 전용 학기표(`fee_terms`)와 `fee_term_id`
  // 칸이 따로 있었는데, 학기가 두 곳에 있으면 반드시 어긋나서 `terms` 하나로 합쳤습니다.
  // 화면이 보내는 이름(feeTermId)은 그대로 받습니다 - 이름만 바꾸자고 화면까지 흔들 이유가 없습니다.
  const termId = (body?.feeTermId as string | undefined) ?? null;
  /**
   * 이 인보이스에 담을 분류.
   *
   * 비우면 그 학생의 항목을 분류 가리지 않고 전부 담습니다(통합 한 장). 하나를 적으면 그
   * 분류만 담습니다 - 교재비와 교복은 나가는 시기가 달라서 한 장으로 묶으면 늦은 쪽 때문에
   * 이른 쪽까지 못 나갑니다.
   */
  const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : null;

  // ── 이미 받은 돈 ──────────────────────────────────────────────────────
  //
  // 학비에만 있던 자리를 학비외에도 둡니다. 교복·교재처럼 올톡페이로 항목마다 따로
  // 결제되는 것들이라, 오히려 여기가 더 자주 쓰입니다.
  const alreadyPaid = (body?.alreadyPaid ?? null) as
    | { paidAt?: string; amount?: number; method?: string; memo?: string }
    | null;
  const paidAt =
    alreadyPaid?.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(alreadyPaid.paidAt) ? alreadyPaid.paidAt : null;
  if (!studentId) return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();

  const [stuRes, itemsRes, ovRes] = await Promise.all([
    // 보호자 연락처 칸이 아직 없는 DB에서도 발행 자체는 되어야 합니다(연락처만 비게 됩니다).
    selectTolerant<StudentRow>(
      (columns) =>
        supabase.from("wr_students").select(columns).eq("is_demo", false).eq("id", studentId) as unknown as
          PromiseLike<{ data: StudentRow[] | null; error: { message: string } | null }>,
      ["id", "name", "name_en", "grade", "class_name", "department"],
      ["mother_phone", "father_phone", "parent_phone", "billing_phone_role", "billing_phone"],
    ),
    // 항목은 전부 읽고 학기는 아래에서 거릅니다. DB에서 `term_id = ?` 로 자르면 학기 칸이
    // 비어 있는 예전 항목이 통째로 빠지는데, 화면에는 그것들이 보입니다 - 표에서 체크한
    // 항목이 청구서에 안 실리는 것이 가장 나쁩니다.
    // active 로는 거르지 않습니다 - 항목은 끄는 것이 아니라 지웁니다(2026-09).
    supabase.from("fee_items").select("*"),
    supabase.from("student_fee_items").select("*").eq("student_id", studentId),
  ]);
  if (stuRes.error) return NextResponse.json({ error: stuRes.error }, { status: 500 });
  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  if (ovRes.error) return NextResponse.json({ error: ovRes.error.message }, { status: 500 });

  const student = stuRes.data[0] ?? null;
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });

  // 고른 학기가 «진행중»인지. 학기 칸이 빈 예전 항목은 진행중 학기에서만 함께 청구됩니다.
  let termIsCurrent = false;
  if (termId) {
    const { data: term, error: termErr } = await supabase.from("terms").select("status").eq("id", termId).maybeSingle();
    if (termErr) return NextResponse.json({ error: `학기를 읽지 못했습니다: ${termErr.message}` }, { status: 500 });
    if (!term) return NextResponse.json({ error: "고른 학기를 찾지 못했습니다." }, { status: 400 });
    termIsCurrent = term.status === "진행중";
  }

  const all = resolveStudentItems(
    ((itemsRes.data as FeeItem[] | null) ?? []).filter((i) => inTerm(i, termId ?? "", termIsCurrent)),
    { id: student.id, grade: student.grade, className: student.class_name, department: student.department },
    (ovRes.data as StudentFeeItem[] | null) ?? [],
  );
  // 분류를 고르는 것도 서버가 합니다. 화면이 고른 줄만 받아서 넣으면, 화면이 틀렸을 때
  // 틀린 내역이 그대로 나갑니다.
  const byCategory = category ? all.filter((l) => l.item.category === category) : all;

  /**
   * **어느 항목을 담을 것인가.**
   *
   * ── 무엇이 문제였나 ───────────────────────────────────────────────────────
   *
   * 「이미 받음」에서 교복 10만원만 체크해도 **그 아이의 학비외 항목이 전부** 담겼습니다.
   * 입금은 체크한 10만원만 붙으니 그 청구서는 일부납으로 남았고, 함께 담긴 교재비가
   * 미납·연체 목록에 다시 떴습니다 - 이미 받았다고 적어둔 것이 되돌아오는 것처럼 보입니다.
   *
   * 이제 화면이 고른 항목 번호를 보내면 **그것만** 담습니다. 금액은 여전히 서버가 냅니다 -
   * 무엇을 담을지는 사람이 정하지만 얼마인지는 자료가 정합니다(§2-12).
   *
   * 안 보내면 예전처럼 전부 담습니다. 고친 적 없는 화면이 갑자기 빈 청구서를 만들면 안
   * 됩니다.
   */
  const askedIds = Array.isArray((body as { itemIds?: unknown } | null)?.itemIds)
    ? ((body as { itemIds: unknown[] }).itemIds.filter((v) => typeof v === "string") as string[])
    : null;
  const lines = askedIds && askedIds.length > 0 ? byCategory.filter((l) => askedIds.includes(l.item.id)) : byCategory;
  if (lines.length === 0) {
    return NextResponse.json(
      {
        error: askedIds
          ? "고른 항목이 이 학생에게 붙어 있지 않습니다. 표에서 다시 확인해주세요."
          : category
            ? `이 학생에게 붙은 ${category} 항목이 없습니다.`
            : "이 학생에게 붙은 항목이 없습니다.",
      },
      { status: 400 },
    );
  }

  const total = lines.reduce((n, l) => n + l.amount, 0);
  const issue = todayKst();
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

  // **이 아이의 결제번호가 기본입니다.** 화면에서 이번 건만 다르게 고르면 그것이 이깁니다 -
  // 한 건만 다른 분께 보내야 하는 경우가 있습니다. 판정은 @/lib/alltalkpay 한 곳에서 합니다.
  const recipient = resolveRecipient(phonesOf(billingOf(student)), guardianRole ?? chosenRoleOf(billingOf(student)));

  // **미납은 저절로 얹히지 않습니다.** 발행할 때마다 자동으로 합치던 것을 껐습니다 - 실측에서
  // 합쳐 커진 청구서가 안 걷혔습니다(200만 초과 7건 3,190만원, 수납 0원). 합치는 것은 사람이
  // 미납금 화면에서 고릅니다(`/finance/unpaid`). 화면이 일부러 보낼 때만 얹습니다.
  const wantCarry = (body as { carryForward?: unknown } | null)?.carryForward === true;
  const carry = wantCarry
    ? await planCarryForward(supabase, { studentId: student.id, stream: "학비외", today: todayKst() })
    : { total: 0, lines: [] as { seq: number; name: string; qty: number; unit_price: number; amount: number }[], lockIds: [] as string[], error: null as string | null };
  if (carry.error) return NextResponse.json({ error: `지난 미납을 읽지 못했습니다: ${carry.error}` }, { status: 500 });

  // 번호는 DB가 정합니다. 사람이 손으로 붙이면 반드시 겹칩니다.
  const { data: noRow, error: noErr } = await supabase.rpc("next_invoice_no");
  if (noErr) return NextResponse.json({ error: `번호를 만들지 못했습니다: ${noErr.message}` }, { status: 500 });

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      invoice_no: noRow as unknown as string,
      stream: "학비외",
      student_id: student.id,
      // 인보이스 양식이 영문이라 영문 이름을 본문으로 씁니다. 없으면 한글 이름을 그대로.
      student_name: student.name_en?.trim() || student.name,
      student_name_ko: student.name,
      grade_label: gradeLabel({ grade: student.grade, className: student.class_name }),
      issue_date: issue,
      // **몇 월치인가.** 화면이 안 주면 발행일의 월을 씁니다 - 지금까지 그렇게 세어 왔으니
      // 그 값이 지금의 참입니다. 9월분을 8월 말에 미리 보내는 경우에만 화면이 따로 고릅니다.
      billing_month: billingMonth ?? issue.slice(0, 7),
      due_date: due,
      total_amount: total + carry.total,
      // 그때의 연락처와 **대상**을 함께 굳힙니다. 명부가 나중에 바뀌어도 어디로, 누구 앞으로
      // 청구했는지가 남습니다. 번호만 남기면 나중에 그게 어머니 것이었는지 알 수 없습니다.
      guardian_phone: recipient?.phone ?? null,
      guardian_role: recipient?.role ?? null,
      term_id: termId,
      category,
      // 소급해 만든 청구서는 학부모에게 보내지 않습니다 - 보내면 «이미 낸 돈을 또 내라»가
      // 됩니다. 화면이 보낼 것과 안 보낼 것을 이 값으로 가릅니다(학비와 같은 규칙).
      issued_offline: !!paidAt,
      issued_by: me.name || me.email,
    })
    .select()
    .single();
  if (invErr || !inv) return NextResponse.json({ error: invErr?.message ?? "발행 실패" }, { status: 500 });

  const { error: lineErr } = await supabase.from("invoice_lines").insert([
    ...lines.map((l, i) => ({
      invoice_id: inv.id,
      seq: i + 1,
      name: l.item.name,
      // **번호를 함께 남깁니다.** 이름이 같은 항목이 넷 있어서(학년별 중국어 교재) 이름만
      // 으로는 「이 항목이 이미 나갔는가」를 가릴 수 없습니다.
      item_id: l.item.id,
      qty: l.qty,
      unit_price: Number(l.item.unit_price),
      amount: l.amount,
    })),
    // 이월 줄은 **맨 아래**에 둡니다. 이번에 새로 청구하는 것이 먼저 읽혀야 합니다.
    ...carry.lines.map((c, i) => ({ invoice_id: inv.id, seq: lines.length + i + 1, ...c })),
  ]);
  // 줄을 못 넣었으면 빈 인보이스가 남습니다. 조용히 두면 총액만 있고 내역이 없는 종이가
  // 나가므로, 머리줄을 지우고 실패로 답합니다.
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

  // 원 청구서 잠금. 실패를 삼키지 않습니다 - 여기서 조용히 넘어가면 같은 돈이 두 곳에
  // 미납으로 남고, 다음 달에 또 이월되어 금액이 눈덩이처럼 불어납니다.
  const lockErr = await lockCarried(supabase, carry.lockIds, inv.id as string);
  if (lockErr) {
    return NextResponse.json(
      { error: `청구서는 만들었지만 지난 미납을 잠그지 못했습니다(${lockErr}). 같은 돈이 두 번 청구될 수 있으니 확인해주세요.` },
      { status: 500 },
    );
  }

  // ── 이미 받은 돈 기록 ────────────────────────────────────────────────
  //
  // 금액을 안 주면 **청구액 전부**를 받은 것으로 봅니다. 다르면 화면에서 금액을 적어
  // 보냅니다 - 「교복만 결제됨」이나 「미납금 일부만」이 그 경우입니다.
  let paidRecorded = 0;
  if (paidAt) {
    const asked = Number(alreadyPaid?.amount);
    const amount = Number.isFinite(asked) && asked > 0 ? Math.round(asked) : total + carry.total;
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
      // **출처는 한 번 적고 안 바꿉니다.** `matched_by` 는 나중에 충당이 덮어쓰므로, 취소가
      // 이 돈을 알아보려면 안 덮이는 칸이 따로 있어야 합니다.
      origin: "이미받음",
      created_by: me.email,
    });
    // 청구서는 만들어졌는데 입금이 안 붙으면 **미납으로 남습니다.** 이미 낸 분에게 독촉이
    // 나가는 자리라, 조용히 넘기지 않고 그대로 알립니다.
    if (payErr) {
      return NextResponse.json(
        {
          error: `청구서(${inv.invoice_no})는 만들었지만 입금을 기록하지 못했습니다: ${payErr.message}. 수납 화면에서 직접 넣어주세요.`,
        },
        { status: 500 },
      );
    }
    paidRecorded = amount;
  }

  /**
   * 먼저 받아둔 돈이 있으면 저절로 붙입니다. 안 붙이면 이미 낸 분에게 독촉이 나갑니다.
   *
   * **「이미 받음」으로 만든 장에는 붙이지 않습니다.** 그 장은 만들면서 받은 돈을 바로
   * 붙였으므로 이미 완납입니다 - 그 위에 선입금까지 얹으면 **받지도 않은 돈이 장부에
   * 들어옵니다.**
   *
   * 실제로 났습니다. 한 학생의 학비외 총청구액이 291,000원인데 납부금액이 482,000원으로
   * 찍혔습니다. 291,000원은 「이미 받음」이 붙인 진짜 돈이고, 나머지 191,000원은 옛
   * 선입금이 그 위에 자동으로 얹힌 것이었습니다. 화면에는 오류가 아니라 **과납**으로
   * 보이고, 과납은 다음 달에 돌려줄 돈으로 읽힙니다.
   *
   * 학비 창구(`/tuition`)에는 이 문지기가 처음부터 있었습니다. 학비외에만 빠져 있었습니다 -
   * 같은 규칙을 두 파일에 각자 적어서 한쪽만 고쳐진 자리입니다.
   */
  const pre = paidAt ? { applied: 0, error: null } : await applyPrepaid(supabase, inv, me.email);
  return NextResponse.json({ ok: true, invoice: inv, paid: paidRecorded, prepaidApplied: pre.applied, warning: pre.error });
}
