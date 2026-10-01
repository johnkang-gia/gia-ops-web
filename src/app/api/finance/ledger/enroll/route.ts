import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

/**
 * 학비 항목의 **납부 옵션을 고르거나 뺍니다** — 학생 창에서.
 *
 * 학비 표의 `pickOption` 과 같은 규칙입니다: 같은 학생·같은 항목·같은 학기는 한 줄, 옵션을
 * 비우면 줄을 지웁니다(active=false 로 두면 다시 고를 때 유일 조건에 걸립니다). 화면이
 * 들고 있는 목록을 믿지 않고 표를 먼저 봅니다 - 두 탭이 어긋나면 중복키로 실패합니다.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { studentId?: string; planId?: string; optionId?: string | null; termId?: string | null };
  const studentId = String(body.studentId ?? "");
  const planId = String(body.planId ?? "");
  const optionId = body.optionId ? String(body.optionId) : null;
  const termId = body.termId ? String(body.termId) : null;
  if (!studentId || !planId) return NextResponse.json({ error: "학생과 항목이 필요합니다." }, { status: 400 });

  const supabase = await createClient();
  let find = supabase.from("student_fee_enrollments").select("id").eq("student_id", studentId).eq("plan_id", planId);
  find = termId ? find.eq("term_id", termId) : find.is("term_id", null);
  const { data: existing, error: findErr } = await find.maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });

  if (!optionId) {
    if (!existing) return NextResponse.json({ ok: true, removed: 0 });
    const { error } = await supabase.from("student_fee_enrollments").delete().eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: 1 });
  }
  if (existing) {
    const { error } = await supabase.from("student_fee_enrollments").update({ option_id: optionId }).eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const { error } = await supabase
    .from("student_fee_enrollments")
    .insert({ student_id: studentId, plan_id: planId, option_id: optionId, term_id: termId, active: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
