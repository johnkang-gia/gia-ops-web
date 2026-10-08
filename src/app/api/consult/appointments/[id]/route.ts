import { NextResponse } from "next/server";
import { consultSession, staffOnly } from "@/lib/consult/access";
import { normalizeTime } from "@/lib/consult/model";

export const dynamic = "force-dynamic";

/**
 * 예약 고치기 — 시각·메모·코스·학생(형제 묶기/풀기). **상태는 여기서 바꾸지 않습니다** -
 * 상태는 기록이 남아야 하므로 `/action` 으로만 바꿉니다.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  if (!s.staff) return staffOnly();

  const body = (await req.json().catch(() => ({}))) as {
    scheduled_time?: string | null;
    note?: string | null;
    course_room_ids?: string[];
    student_ids?: string[];
  };
  const patch: Record<string, unknown> = { updated_by: s.me.email };
  if ("scheduled_time" in body) {
    const t = body.scheduled_time ? normalizeTime(body.scheduled_time) : null;
    if (body.scheduled_time && !t) return NextResponse.json({ error: "시각을 읽지 못했습니다. 14:20 처럼 적어 주세요." }, { status: 400 });
    patch.scheduled_time = t;
  }
  if ("note" in body) patch.note = (body.note ?? "").trim() || null;
  if ("course_room_ids" in body) patch.course_room_ids = body.course_room_ids ?? [];

  const { error } = await s.supabase.from("consult_appointments").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.student_ids) {
    const ids = [...new Set(body.student_ids)];
    if (ids.length === 0) return NextResponse.json({ error: "학생이 한 명은 있어야 합니다. 예약을 지우려면 「삭제」를 눌러 주세요." }, { status: 400 });
    const { error: delErr } = await s.supabase.from("consult_appointment_students").delete().eq("appointment_id", id).not("student_id", "in", `(${ids.join(",")})`);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { error: upErr } = await s.supabase
      .from("consult_appointment_students")
      .upsert(ids.map((sid) => ({ appointment_id: id, student_id: sid })), { onConflict: "appointment_id,student_id", ignoreDuplicates: true });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * 예약 지우기. 이미 상담이 시작됐던 예약은 지우지 않고 「취소」로 둡니다 - 지우면 그 상담의
 * 메모와 기록이 함께 사라집니다.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  if (!s.staff) return staffOnly();

  const { count, error: cErr } = await s.supabase
    .from("consult_status_log")
    .select("id", { count: "exact", head: true })
    .eq("appointment_id", id)
    .eq("to_status", "상담중");
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if ((count ?? 0) > 0) return NextResponse.json({ error: "상담이 진행된 예약은 지울 수 없습니다. 「취소」를 눌러 주세요." }, { status: 409 });

  const { error } = await s.supabase.from("consult_appointments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
