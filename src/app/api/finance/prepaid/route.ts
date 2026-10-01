import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { PAYMENT_METHOD_KINDS } from "@/lib/payments";

/**
 * **예치금 넣기** — 청구서에 안 붙는 입금 한 줄.
 *
 * 큰 돈을 먼저 내고 거기서 깎아 달라는 집이 있습니다. 지금까지 그 돈을 적을 자리가 없었습니다 -
 * 청구서가 있어야만 입금을 넣을 수 있었으니까요. 메모에 적어두면 그 메모는 장부가 아니라서,
 * 다음 청구서는 그 돈을 모르고 「미납」으로 나갑니다.
 *
 * 여기서 넣는 줄은 `invoice_id = null` · `origin = '미리받음'` 입니다. 새 표도 새 상태도 없습니다.
 * 다음 청구서를 만들 때 `prepaidApply` 가 저절로 가져가고, 예치금 화면에 「미리 받음」으로
 * 보입니다. 과납(`origin = '과납'`)·취소로 떼어낸 돈과 **한 통**입니다 - 학부모가 낸 돈은 학생
 * 계정에 있는 돈이지 학비용·교복용이 따로 있지 않습니다.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    studentId?: string;
    paidAt?: string;
    amount?: number;
    method?: string;
    payerName?: string;
    memo?: string;
  };

  const studentId = String(body.studentId ?? "");
  if (!studentId) return NextResponse.json({ error: "학생을 골라주세요." }, { status: 400 });
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "금액을 적어주세요." }, { status: 400 });
  const method = String(body.method ?? "");
  if (!(PAYMENT_METHOD_KINDS as readonly string[]).includes(method)) {
    return NextResponse.json({ error: `납부 수단을 골라주세요(${PAYMENT_METHOD_KINDS.join(" · ")}).` }, { status: 400 });
  }
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.paidAt ?? "")) ? String(body.paidAt) : null;
  if (!paidAt) return NextResponse.json({ error: "받은 날을 적어주세요." }, { status: 400 });

  const supabase = await createClient();
  const { data: student, error: stErr } = await supabase
    .from("wr_students")
    .select("id, name")
    .eq("is_demo", false)
    .eq("id", studentId)
    .maybeSingle();
  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });

  const memo = String(body.memo ?? "").trim();
  const { data: made, error } = await supabase
    .from("payments")
    .insert({
      invoice_id: null,
      student_id: student.id,
      paid_at: paidAt,
      amount,
      method,
      method_kind: method,
      payer_name: String(body.payerName ?? "").trim() || student.name,
      // 왜 미리 받았는지는 사람이 적습니다. 비면 기본 문구 - 비어 있는 메모는 몇 달 뒤 아무도
      // 못 읽습니다.
      memo: memo || "미리 받은 돈. 다음 청구서에서 깎입니다.",
      source: "수기",
      matched_by: "예치금",
      origin: "미리받음",
      created_by: me.email,
    })
    .select("id")
    .single();
  if (error || !made) return NextResponse.json({ error: error?.message ?? "저장 실패" }, { status: 500 });

  return NextResponse.json({ ok: true, id: made.id });
}
