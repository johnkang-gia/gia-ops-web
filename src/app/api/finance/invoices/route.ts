import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { gradeLabel, resolveStudentItems } from "@/lib/feeItems";
import { todayKst } from "@/lib/kst";
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

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const studentId = body?.studentId as string | undefined;
  const dueDate = (body?.dueDate as string | undefined) ?? null;
  if (!studentId) return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();

  const [stuRes, itemsRes, ovRes] = await Promise.all([
    supabase.from("wr_students").select("id, name, name_en, grade, class_name, parent_phone").eq("id", studentId).maybeSingle(),
    supabase.from("fee_items").select("*").eq("active", true),
    supabase.from("student_fee_items").select("*").eq("student_id", studentId),
  ]);
  if (stuRes.error) return NextResponse.json({ error: stuRes.error.message }, { status: 500 });
  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  if (ovRes.error) return NextResponse.json({ error: ovRes.error.message }, { status: 500 });

  const student = stuRes.data as { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null; parent_phone: string | null } | null;
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });

  const lines = resolveStudentItems(
    (itemsRes.data as FeeItem[] | null) ?? [],
    { id: student.id, grade: student.grade, className: student.class_name },
    (ovRes.data as StudentFeeItem[] | null) ?? [],
  );
  if (lines.length === 0) {
    return NextResponse.json({ error: "이 학생에게 붙은 항목이 없습니다." }, { status: 400 });
  }

  const total = lines.reduce((n, l) => n + l.amount, 0);
  const issue = todayKst();
  const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : issue;

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
      // 그때의 보호자 연락처를 같이 굳힙니다. 명부가 나중에 바뀌어도 어디로 청구했는지가 남습니다.
      guardian_phone: student.parent_phone,
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
