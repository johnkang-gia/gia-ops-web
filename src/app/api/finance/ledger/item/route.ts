import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

/**
 * 학비외 항목을 이 학생에게 **넣거나 뺍니다** — 학생 창에서.
 *
 * `student_fee_items` 는 「기본 세트와 다른 점」만 적는 표입니다(include/exclude). 기본 대상인
 * 항목을 빼면 exclude 줄, 기본이 아닌 항목을 넣으면 include 줄. 기본과 같아지면 줄을 지웁니다 -
 * 안 그러면 기본 세트가 바뀌었을 때 이 아이만 옛 값에 묶입니다.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    studentId?: string;
    itemId?: string;
    include?: boolean;
    isDefault?: boolean;
    qty?: number;
    termId?: string | null;
  };
  const studentId = String(body.studentId ?? "");
  const itemId = String(body.itemId ?? "");
  if (!studentId || !itemId) return NextResponse.json({ error: "학생과 항목이 필요합니다." }, { status: 400 });
  const include = body.include !== false;
  const isDefault = body.isDefault === true;
  const qty = Math.max(1, Math.round(Number(body.qty ?? 1)) || 1);

  const supabase = await createClient();
  const { data: existing, error: findErr } = await supabase
    .from("student_fee_items")
    .select("id")
    .eq("student_id", studentId)
    .eq("item_id", itemId)
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });

  // 기본과 같아지는 경우(기본 대상을 include 수량 1, 기본 아님을 exclude)는 줄을 지웁니다.
  const sameAsDefault = include === isDefault && qty === 1;
  if (sameAsDefault) {
    if (!existing) return NextResponse.json({ ok: true });
    const { error } = await supabase.from("student_fee_items").delete().eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const row = { mode: include ? "include" : "exclude", qty: include ? qty : 1, updated_by: me.email };
  if (existing) {
    const { error } = await supabase.from("student_fee_items").update(row).eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const { error } = await supabase
    .from("student_fee_items")
    .insert({ student_id: studentId, item_id: itemId, term_id: body.termId ?? null, ...row });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
