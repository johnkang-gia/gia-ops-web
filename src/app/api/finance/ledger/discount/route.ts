import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

/**
 * 학비 항목에 할인을 **붙이거나 뗍니다** — 학생 창에서. 학비 일괄 표의 `toggleDiscount` 와 같은 규칙:
 * 같은 학생·항목·할인·학기는 한 줄, 떼면 그 줄을 지웁니다. 승인이 필요한 할인은 여기서도 막습니다.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { studentId?: string; planId?: string; discountId?: string; on?: boolean; termId?: string | null };
  const studentId = String(body.studentId ?? "");
  const planId = String(body.planId ?? "");
  const discountId = String(body.discountId ?? "");
  const termId = body.termId ? String(body.termId) : null;
  if (!studentId || !planId || !discountId) return NextResponse.json({ error: "학생·항목·할인이 필요합니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: d, error: dErr } = await supabase.from("fee_discounts").select("id, requires_approval, active").eq("id", discountId).maybeSingle();
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  if (!d) return NextResponse.json({ error: "그런 할인이 없습니다." }, { status: 404 });

  let find = supabase.from("student_fee_discounts").select("id").eq("student_id", studentId).eq("discount_id", discountId).eq("plan_id", planId);
  find = termId ? find.or(`term_id.eq.${termId},term_id.is.null`) : find;
  const { data: existing, error: fErr } = await find.limit(1).maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });

  if (body.on === false) {
    if (!existing) return NextResponse.json({ ok: true, removed: 0 });
    const { error } = await supabase.from("student_fee_discounts").delete().eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: 1 });
  }
  if (existing) return NextResponse.json({ ok: true });
  if (d.requires_approval) return NextResponse.json({ error: "최고관리자 승인이 필요한 할인입니다. 학비 일괄 표에서 승인 절차로 붙여주세요." }, { status: 403 });
  const { error } = await supabase.from("student_fee_discounts").insert({ student_id: studentId, discount_id: discountId, plan_id: planId, term_id: termId, active: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
