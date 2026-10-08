import { NextResponse } from "next/server";
import { consultSession, staffOnly } from "@/lib/consult/access";
import { groupForBulk, minutesToTime, normalizeTime, sequentialTimes, timeToMinutes } from "@/lib/consult/model";
import { loadStudents } from "@/lib/students";

export const dynamic = "force-dynamic";

type Single = {
  mode: "single";
  /** 고른 아이와, 함께 넣기로 한 형제들. */
  student_ids: string[];
  /** true 면 한 예약에 함께, false 면 아이마다 따로(시각은 기본 상담 시간만큼 이어서). */
  together: boolean;
  scheduled_time?: string | null;
  room_id?: string | null;
  course_room_ids?: string[];
  note?: string | null;
};

type Bulk = {
  mode: "classes";
  class_ids: string[];
  sibling: "together" | "separate";
  start_time?: string | null;
  interval?: number;
  /** "homeroom" = 그 반 담임 선생님 방, 상담실 번호 = 그 방, null = 미정. */
  room?: string | null;
  course_room_ids?: string[];
};

/**
 * 명단 넣기 — **운영앱 명부에서 고릅니다.** 이름을 손으로 적는 칸은 없습니다(김재이가 셋입니다,
 * CLAUDE.md §2-4-1). 같은 아이가 이 행사에 이미 있으면(취소 제외) 건너뛰고 몇 명 건너뛰었는지 알립니다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  if (!s.staff) return staffOnly();

  const body = (await req.json().catch(() => ({}))) as Single | Bulk;

  const { data: ev, error: evErr } = await s.supabase
    .from("consult_events")
    .select("id, is_demo, default_minutes")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
  if (!ev) return NextResponse.json({ error: "행사를 찾지 못했습니다." }, { status: 404 });
  const event = ev as { id: string; is_demo: boolean; default_minutes: number };

  // 이미 명단에 있는 아이(취소된 예약은 다시 넣을 수 있습니다).
  const { data: existing, error: exErr } = await s.supabase
    .from("consult_appointments")
    .select("status, consult_appointment_students(student_id)")
    .eq("event_id", eventId);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const already = new Set(
    ((existing ?? []) as { status: string; consult_appointment_students: { student_id: string }[] | null }[])
      .filter((a) => a.status !== "취소")
      .flatMap((a) => (a.consult_appointment_students ?? []).map((x) => x.student_id)),
  );

  type Plan = { student_ids: string[]; scheduled_time: string | null; room_id: string | null; course_room_ids: string[]; note: string | null };
  const plans: Plan[] = [];

  if (body.mode === "single") {
    const ids = [...new Set(body.student_ids ?? [])].filter((x) => !already.has(x));
    if (ids.length === 0) return NextResponse.json({ error: "이미 명단에 있는 학생입니다." }, { status: 409 });
    // 명부에 있는 번호인지 확인합니다(다른 학교·연습용 번호가 섞이지 않게).
    const { rows, error } = await loadStudents(s.supabase, { ids, demo: event.is_demo });
    if (error) return NextResponse.json({ error }, { status: 500 });
    const valid = ids.filter((x) => rows.some((r) => r.id === x));
    if (valid.length === 0) return NextResponse.json({ error: "명부에서 찾을 수 없는 학생입니다." }, { status: 400 });
    const time = normalizeTime(body.scheduled_time);
    const base = { room_id: body.room_id || null, course_room_ids: body.course_room_ids ?? [], note: (body.note ?? "").trim() || null };
    if (body.together) plans.push({ student_ids: valid, scheduled_time: time, ...base });
    else {
      const start = timeToMinutes(time);
      valid.forEach((sid, i) =>
        plans.push({ student_ids: [sid], scheduled_time: start === null ? null : minutesToTime(start + i * event.default_minutes), ...base }),
      );
    }
  } else if (body.mode === "classes") {
    if (!body.class_ids?.length) return NextResponse.json({ error: "반을 하나 이상 골라 주세요." }, { status: 400 });
    const { rows, error } = await loadStudents(s.supabase, { demo: event.is_demo, order: "grade" });
    if (error) return NextResponse.json({ error }, { status: 500 });
    const picked = rows.filter((r) => r.class_id && body.class_ids.includes(r.class_id) && !already.has(r.id));

    // 담임 방: 반 → 담임 이메일 → 같은 선생님의 상담실.
    let homeroomRoomOfClass = new Map<string, string>();
    if (body.room === "homeroom") {
      const [clsRes, roomRes] = await Promise.all([
        s.supabase.from("wr_classes").select("id, teacher_email").eq("is_demo", event.is_demo).in("id", body.class_ids),
        s.supabase.from("consult_rooms").select("id, teacher_email").eq("event_id", eventId),
      ]);
      if (clsRes.error || roomRes.error) return NextResponse.json({ error: (clsRes.error ?? roomRes.error)!.message }, { status: 500 });
      const roomOfTeacher = new Map(
        ((roomRes.data ?? []) as { id: string; teacher_email: string | null }[])
          .filter((r) => r.teacher_email)
          .map((r) => [(r.teacher_email as string).toLowerCase(), r.id]),
      );
      homeroomRoomOfClass = new Map(
        ((clsRes.data ?? []) as { id: string; teacher_email: string | null }[])
          .map((c) => [c.id, roomOfTeacher.get((c.teacher_email ?? "").toLowerCase()) ?? ""] as [string, string])
          .filter(([, r]) => !!r),
      );
    }

    const groups = groupForBulk(picked, body.sibling);
    const times = sequentialTimes(groups.length, normalizeTime(body.start_time), Math.max(1, Number(body.interval) || event.default_minutes));
    const classOf = new Map(picked.map((p) => [p.id, p.class_id]));
    groups.forEach((g, i) => {
      const room =
        body.room === "homeroom" ? homeroomRoomOfClass.get(classOf.get(g[0]) ?? "") ?? null : body.room ? body.room : null;
      plans.push({ student_ids: g, scheduled_time: times[i], room_id: room, course_room_ids: body.course_room_ids ?? [], note: null });
    });
    if (plans.length === 0) return NextResponse.json({ error: "넣을 학생이 없습니다(모두 이미 명단에 있습니다).", skipped: already.size }, { status: 409 });
  } else {
    return NextResponse.json({ error: "넣는 방법을 알 수 없습니다." }, { status: 400 });
  }

  // 번호를 여기서 만들어 두면 예약과 학생 잇기를 한 번에 맞출 수 있습니다(돌아오는 순서에 기대지 않습니다).
  const withIds = plans.map((p) => ({ ...p, id: crypto.randomUUID() }));
  const { error: insErr } = await s.supabase.from("consult_appointments").insert(
    withIds.map((p) => ({
      id: p.id,
      event_id: eventId,
      scheduled_time: p.scheduled_time,
      room_id: p.room_id,
      course_room_ids: p.course_room_ids,
      note: p.note,
      updated_by: s.me.email,
    })),
  );
  if (insErr) return NextResponse.json({ error: `명단을 넣지 못했습니다: ${insErr.message}` }, { status: 500 });
  const { error: linkErr } = await s.supabase
    .from("consult_appointment_students")
    .insert(withIds.flatMap((p) => p.student_ids.map((sid) => ({ appointment_id: p.id, student_id: sid }))));
  if (linkErr) {
    // 학생이 안 붙은 예약은 «이름 없음»으로 남습니다. 남기지 않고 지웁니다.
    await s.supabase.from("consult_appointments").delete().in("id", withIds.map((p) => p.id));
    return NextResponse.json({ error: `학생을 잇지 못해 넣은 명단을 되돌렸습니다: ${linkErr.message}` }, { status: 500 });
  }
  const studentCount = withIds.reduce((t, p) => t + p.student_ids.length, 0);
  return NextResponse.json({ ok: true, appointments: withIds.length, students: studentCount });
}
