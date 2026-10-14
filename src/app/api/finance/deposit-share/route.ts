import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { loadStudents } from "@/lib/students";
import { poolOf } from "@/lib/depositShare";

/**
 * **예치금 공유 묶음 보기·묶기·풀기.**
 *
 * 묶으면 두 학생의 예치금이 한 통이 됩니다 - 어느 아이 청구서에서든 꺼내 쓸 수 있고, 줄은 하나씩만 있어 같은 돈이
 * 두 번 빠지지 않습니다(`depositShare.ts`). 풀어도 돈은 움직이지 않습니다. 각 줄은 맡긴 학생 앞으로 그대로 남습니다.
 *
 * 형제는 명부의 형제 묶음(`sibling_group_id`)으로 먼저 제안하지만, 형제가 아닌 학생도 묶을 수 있습니다 - 사촌·
 * 같은 보호자가 맡긴 돈처럼 «한 집 돈»은 명부의 형제 관계와 꼭 같지 않습니다.
 */

export const dynamic = "force-dynamic";

async function guard() {
  const me = await getCurrentAppUser();
  if (!me) return { me: null, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!hasFinanceAccess(me)) return { me: null, res: NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 }) };
  return { me, res: null };
}

export async function GET(req: Request) {
  const g = await guard();
  if (g.res) return g.res;
  const studentId = new URL(req.url).searchParams.get("studentId") ?? "";
  if (!studentId) return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });
  const supabase = await createClient();

  const pool = await poolOf(supabase, studentId);
  if (pool.error) return NextResponse.json({ error: pool.error }, { status: 500 });
  const [stu, dep] = await Promise.all([
    // 고르기 목록(검색형)과 형제 제안에 씁니다. 퇴소생도 예치금이 남아 있을 수 있어 전부 읽습니다.
    loadStudents(supabase, { status: "all" }),
    supabase.from("payments").select("student_id, amount").in("student_id", pool.memberIds).is("invoice_id", null),
  ]);
  if (stu.error) return NextResponse.json({ error: stu.error }, { status: 500 });
  if (dep.error) return NextResponse.json({ error: `예치금을 읽지 못했습니다: ${dep.error.message}` }, { status: 500 });

  const byId = new Map(stu.rows.map((s) => [s.id, s]));
  const left = new Map<string, number>();
  for (const r of (dep.data as { student_id: string; amount: number | string }[] | null) ?? []) {
    left.set(r.student_id, (left.get(r.student_id) ?? 0) + Number(r.amount));
  }
  const me = byId.get(studentId);
  const members = pool.memberIds.map((id) => ({
    id,
    name: byId.get(id)?.name ?? "이름 미확인",
    grade: byId.get(id)?.grade ?? null,
    className: byId.get(id)?.class_name ?? null,
    deposit: Math.max(0, left.get(id) ?? 0),
  }));
  const siblings = me?.sibling_group_id
    ? stu.rows.filter((s) => s.sibling_group_id === me.sibling_group_id && s.id !== studentId && !pool.memberIds.includes(s.id)).map((s) => ({ id: s.id, name: s.name }))
    : [];
  return NextResponse.json({
    share: pool.share ? { id: pool.share.id, name: pool.share.name } : null,
    members,
    balance: Math.max(0, [...left.values()].reduce((n, v) => n + v, 0)),
    siblings,
    students: stu.rows.map((s) => ({ id: s.id, name: s.name, grade: s.grade, class_name: s.class_name, name_en: s.name_en, student_no: s.student_no, birth_date: s.birth_date })),
  });
}

export async function POST(req: Request) {
  const g = await guard();
  if (g.res) return g.res;
  const me = g.me!;
  const body = (await req.json().catch(() => ({}))) as { action?: string; studentId?: string; withStudentId?: string; name?: string };
  const studentId = String(body.studentId ?? "");
  if (!studentId) return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });
  const supabase = await createClient();

  if (body.action === "unlink") {
    const pool = await poolOf(supabase, studentId);
    if (pool.error) return NextResponse.json({ error: pool.error }, { status: 500 });
    if (!pool.share) return NextResponse.json({ ok: true });
    const { error } = await supabase.from("deposit_share_members").delete().eq("student_id", studentId);
    if (error) return NextResponse.json({ error: `공유를 풀지 못했습니다: ${error.message}` }, { status: 500 });
    // 혼자 남은 묶음은 지웁니다. 한 명짜리 «공유»가 남으면 화면이 공유 중이라고 거짓말을 합니다.
    if (pool.memberIds.filter((id) => id !== studentId).length < 2) {
      const { error: delErr } = await supabase.from("deposit_shares").delete().eq("id", pool.share.id);
      if (delErr) return NextResponse.json({ error: `빈 공유 묶음을 지우지 못했습니다: ${delErr.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "link") return NextResponse.json({ error: "action 은 link 또는 unlink 입니다." }, { status: 400 });
  const other = String(body.withStudentId ?? "");
  if (!other || other === studentId) return NextResponse.json({ error: "함께 쓸 다른 학생을 골라주세요." }, { status: 400 });

  const [a, b] = await Promise.all([poolOf(supabase, studentId), poolOf(supabase, other)]);
  if (a.error || b.error) return NextResponse.json({ error: a.error ?? b.error }, { status: 500 });
  // 두 묶음을 합치지 않습니다. 합치면 그 사이 각 묶음에서 «누구 돈을 누구에게 썼나»의 경계가 흐려집니다 - 한쪽을
  // 풀고 다시 묶게 해서 사람이 한 번 확인하게 합니다.
  if (a.share && b.share && a.share.id !== b.share.id) {
    return NextResponse.json({ error: `두 학생이 이미 다른 공유 묶음에 있습니다(${a.share.name} · ${b.share.name}). 한쪽을 풀고 다시 묶어주세요.` }, { status: 409 });
  }
  if (a.share && b.share) return NextResponse.json({ ok: true, shareId: a.share.id });

  let shareId = a.share?.id ?? b.share?.id ?? null;
  if (!shareId) {
    const { rows } = await loadStudents(supabase, { ids: [studentId, other], status: "all" });
    const names = rows.map((s) => s.name).join("·");
    const { data: made, error } = await supabase
      .from("deposit_shares")
      .insert({ name: String(body.name ?? "").trim() || `${names} 예치금`, created_by: me.name || me.email })
      .select("id")
      .single();
    if (error || !made) return NextResponse.json({ error: `공유 묶음을 만들지 못했습니다: ${error?.message ?? ""}` }, { status: 500 });
    shareId = (made as { id: string }).id;
  }
  const toAdd = [studentId, other].filter((id) => !(a.share && id === studentId) && !(b.share && id === other));
  const { error: addErr } = await supabase
    .from("deposit_share_members")
    .insert(toAdd.map((id) => ({ share_id: shareId, student_id: id, added_by: me.name || me.email })));
  if (addErr) return NextResponse.json({ error: `공유 묶음에 넣지 못했습니다: ${addErr.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, shareId });
}
