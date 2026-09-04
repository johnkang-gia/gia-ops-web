import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { gradeLabel, resolveStudentItems } from "@/lib/feeItems";
import { selectTolerant } from "@/lib/selectTolerant";
import { todayKst } from "@/lib/kst";
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
  const feeTermId = (body?.feeTermId as string | undefined) ?? null;
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
    // 그 학기 항목만 계산합니다. 학기를 안 걸면 지난 학기 교재까지 청구서에 붙습니다.
    // active 로는 거르지 않습니다 - 항목은 끄는 것이 아니라 지웁니다(2026-09).
    (feeTermId
      ? supabase.from("fee_items").select("*").eq("fee_term_id", feeTermId)
      : supabase.from("fee_items").select("*")),
    supabase.from("student_fee_items").select("*").eq("student_id", studentId),
  ]);
  if (stuRes.error) return NextResponse.json({ error: stuRes.error }, { status: 500 });
  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  if (ovRes.error) return NextResponse.json({ error: ovRes.error.message }, { status: 500 });

  const student = stuRes.data[0] ?? null;
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });

  const all = resolveStudentItems(
    (itemsRes.data as FeeItem[] | null) ?? [],
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

  // 번호는 DB가 정합니다. 사람이 손으로 붙이면 반드시 겹칩니다.
  const { data: noRow, error: noErr } = await supabase.rpc("next_invoice_no");
  if (noErr) return NextResponse.json({ error: `번호를 만들지 못했습니다: ${noErr.message}` }, { status: 500 });

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      invoice_no: noRow as unknown as string,
      student_id: student.id,
      // 인보이스 양식이 영문이라 영문 이름을 본문으로 씁니다. 없으면 한글 이름을 그대로.
      student_name: student.name_en?.trim() || student.name,
      student_name_ko: student.name,
      grade_label: gradeLabel({ grade: student.grade, className: student.class_name }),
      issue_date: issue,
      due_date: due,
      total_amount: total,
      // 그때의 연락처와 **대상**을 함께 굳힙니다. 명부가 나중에 바뀌어도 어디로, 누구 앞으로
      // 청구했는지가 남습니다. 번호만 남기면 나중에 그게 어머니 것이었는지 알 수 없습니다.
      guardian_phone: recipient?.phone ?? null,
      guardian_role: recipient?.role ?? null,
      fee_term_id: feeTermId,
      category,
      issued_by: me.name || me.email,
    })
    .select()
    .single();
  if (invErr || !inv) return NextResponse.json({ error: invErr?.message ?? "발행 실패" }, { status: 500 });

  const { error: lineErr } = await supabase.from("invoice_lines").insert(
    lines.map((l, i) => ({
      invoice_id: inv.id,
      seq: i + 1,
      name: l.item.name,
      qty: l.qty,
      unit_price: Number(l.item.unit_price),
      amount: l.amount,
    })),
  );
  // 줄을 못 넣었으면 빈 인보이스가 남습니다. 조용히 두면 총액만 있고 내역이 없는 종이가
  // 나가므로, 머리줄을 지우고 실패로 답합니다.
  if (lineErr) {
    await supabase.from("invoices").delete().eq("id", inv.id);
    return NextResponse.json({ error: `내역을 저장하지 못했습니다: ${lineErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invoice: inv });
}
