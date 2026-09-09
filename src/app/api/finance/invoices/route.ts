import { NextResponse } from "next/server";
import { applyPrepaid } from "@/lib/prepaidApply";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { gradeLabel, inTerm, resolveStudentItems } from "@/lib/feeItems";
import { selectTolerant } from "@/lib/selectTolerant";
import { todayKst } from "@/lib/kst";
import { planCarryForward, lockCarried } from "@/lib/carryForward";
import { resolveRecipient, type GuardianRole } from "@/lib/alltalkpay";
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
};

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
  if (!studentId) return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();

  const [stuRes, itemsRes, ovRes] = await Promise.all([
    // 보호자 연락처 칸이 아직 없는 DB에서도 발행 자체는 되어야 합니다(연락처만 비게 됩니다).
    selectTolerant<StudentRow>(
      (columns) =>
        supabase.from("wr_students").select(columns).eq("is_demo", false).eq("id", studentId) as unknown as
          PromiseLike<{ data: StudentRow[] | null; error: { message: string } | null }>,
      ["id", "name", "name_en", "grade", "class_name", "department"],
      ["mother_phone", "father_phone", "parent_phone"],
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
  const lines = category ? all.filter((l) => l.item.category === category) : all;
  if (lines.length === 0) {
    return NextResponse.json(
      { error: category ? `이 학생에게 붙은 ${category} 항목이 없습니다.` : "이 학생에게 붙은 항목이 없습니다." },
      { status: 400 },
    );
  }

  const total = lines.reduce((n, l) => n + l.amount, 0);
  const issue = todayKst();
  const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : issue;

  const recipient = resolveRecipient(
    { mother_phone: student.mother_phone ?? null, father_phone: student.father_phone ?? null, parent_phone: student.parent_phone ?? null },
    guardianRole
  );

  // 지난 미납을 이 청구서에 얹습니다(학비외 갈래만). 학부모는 한 장만 보면 되고, 원 청구서는
  // 아래에서 「이월됨」으로 잠급니다 - 안 잠그면 같은 돈이 두 곳에 미납으로 남습니다.
  const carry = await planCarryForward(supabase, { studentId: student.id, stream: "학비외", today: todayKst() });
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
      due_date: due,
      total_amount: total + carry.total,
      // 그때의 연락처와 **대상**을 함께 굳힙니다. 명부가 나중에 바뀌어도 어디로, 누구 앞으로
      // 청구했는지가 남습니다. 번호만 남기면 나중에 그게 어머니 것이었는지 알 수 없습니다.
      guardian_phone: recipient?.phone ?? null,
      guardian_role: recipient?.role ?? null,
      term_id: termId,
      category,
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

  // 먼저 받아둔 돈이 있으면 저절로 붙입니다. 안 붙이면 이미 낸 분에게 독촉이 나갑니다.
  const pre = await applyPrepaid(supabase, inv, me.email);
  return NextResponse.json({ ok: true, invoice: inv, prepaidApplied: pre.applied, warning: pre.error });
}
