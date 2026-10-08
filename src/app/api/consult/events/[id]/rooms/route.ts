import { NextResponse } from "next/server";
import { consultSession, staffOnly } from "@/lib/consult/access";

export const dynamic = "force-dynamic";

type RoomIn = { id?: string | null; name?: string; teacher_email?: string | null; teacher_name?: string | null; grade_label?: string | null };

/**
 * 상담실 목록을 한 번에 저장합니다(추가·수정·삭제·순서). 시트판의 `saveRooms` 와 같은 일을
 * 하지만, 예약은 상담실을 **이름이 아니라 번호로** 가리키므로 이름을 바꿔도 예약을 따로 고칠
 * 필요가 없습니다(시트판은 이름이 바뀌면 명단 칸을 하나하나 바꿔 적어야 했습니다).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  if (!s.staff) return staffOnly();

  const body = (await req.json().catch(() => ({}))) as { rooms?: RoomIn[] };
  const list = (body.rooms ?? [])
    .map((r, i) => ({
      id: r.id || null,
      name: String(r.name ?? "").trim(),
      teacher_email: (r.teacher_email ?? "").trim().toLowerCase() || null,
      teacher_name: (r.teacher_name ?? "").trim() || null,
      grade_label: (r.grade_label ?? "").trim() || null,
      sort_order: i,
    }))
    .filter((r) => r.name);
  const names = list.map((r) => r.name);
  if (new Set(names).size !== names.length) return NextResponse.json({ error: "같은 이름의 상담실이 두 개 있습니다." }, { status: 400 });

  const { data: existing, error: exErr } = await s.supabase.from("consult_rooms").select("id").eq("event_id", eventId);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const keep = new Set(list.filter((r) => r.id).map((r) => r.id as string));
  const removed = ((existing ?? []) as { id: string }[]).map((r) => r.id).filter((x) => !keep.has(x));

  // 지우는 방에 예약이 걸려 있으면 그 예약은 «방 미정»이 됩니다(외래키 on delete set null).
  if (removed.length) {
    const { error } = await s.supabase.from("consult_rooms").delete().in("id", removed);
    if (error) return NextResponse.json({ error: `상담실을 지우지 못했습니다: ${error.message}` }, { status: 500 });
  }
  // 이름 맞바꾸기(1반↔2반)가 유일 색인에 걸리지 않게, 고치는 방은 잠깐 임시 이름을 거칩니다.
  const updates = list.filter((r) => r.id);
  for (const r of updates) {
    const { error } = await s.supabase.from("consult_rooms").update({ name: `__tmp_${r.id}` }).eq("id", r.id as string);
    if (error) return NextResponse.json({ error: `상담실을 고치지 못했습니다: ${error.message}` }, { status: 500 });
  }
  for (const r of updates) {
    const { id, ...rest } = r;
    const { error } = await s.supabase.from("consult_rooms").update(rest).eq("id", id as string);
    if (error) return NextResponse.json({ error: `상담실을 고치지 못했습니다: ${error.message}` }, { status: 500 });
  }
  const fresh = list.filter((r) => !r.id).map(({ id: _id, ...rest }) => ({ ...rest, event_id: eventId }));
  if (fresh.length) {
    const { error } = await s.supabase.from("consult_rooms").insert(fresh);
    if (error) return NextResponse.json({ error: `상담실을 넣지 못했습니다: ${error.message}` }, { status: 500 });
  }

  // 지운 방이 순회 코스에 남아 있으면 그 예약은 영영 «남은 방»을 기다립니다. 코스에서도 뺍니다.
  if (removed.length) {
    const { data: appts, error } = await s.supabase
      .from("consult_appointments")
      .select("id, course_room_ids, done_room_ids")
      .eq("event_id", eventId);
    if (error) return NextResponse.json({ error: `코스를 정리하지 못했습니다: ${error.message}` }, { status: 500 });
    for (const a of (appts ?? []) as { id: string; course_room_ids: string[] | null; done_room_ids: string[] | null }[]) {
      const course = (a.course_room_ids ?? []).filter((x) => !removed.includes(x));
      const done = (a.done_room_ids ?? []).filter((x) => !removed.includes(x));
      if (course.length !== (a.course_room_ids ?? []).length || done.length !== (a.done_room_ids ?? []).length) {
        const { error: e2 } = await s.supabase.from("consult_appointments").update({ course_room_ids: course, done_room_ids: done }).eq("id", a.id);
        if (e2) return NextResponse.json({ error: `코스를 정리하지 못했습니다: ${e2.message}` }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
