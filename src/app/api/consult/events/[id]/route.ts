import { NextResponse } from "next/server";
import { consultSession, newShortCode, staffOnly } from "@/lib/consult/access";
import { loadConsultState } from "@/lib/consult/server";

export const dynamic = "force-dynamic";

/**
 * 행사 하나의 지금 상태(상담실·예약·기록·메모). 안내데스크와 면담자 화면이 실시간 신호를
 * 받을 때마다 이걸 다시 읽습니다. 보호자 번호는 행정실 이상에게만 담습니다 - 전화상담으로
 * 바꿀 때 안내데스크가 거는 번호이고, 선생님 화면에는 필요 없습니다.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  const { state, error } = await loadConsultState(s.supabase, id, { phones: s.staff });
  if (!state) return NextResponse.json({ error: error ?? "행사를 읽지 못했습니다." }, { status: error?.includes("찾지") ? 404 : 500 });
  return NextResponse.json({ state, me: { email: s.me.email, staff: s.staff } });
}

const EDITABLE = [
  "name",
  "event_date",
  "end_date",
  "status",
  "mask_names",
  "sibling_default",
  "default_minutes",
  "board_enabled",
  "board_expires_at",
  "personal_links_enabled",
  "room_links_enabled",
] as const;

/** 행사 설정. `rotate_board` 를 보내면 현황판 열쇠와 짧은 주소를 새로 뽑습니다(옛 주소는 그 순간 닫힘). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  if (!s.staff) return staffOnly();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> & { rotate_board?: boolean; rotate_rooms?: boolean };
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === "" ? null : body[k];
  if ("name" in patch && !String(patch.name ?? "").trim()) return NextResponse.json({ error: "행사 이름은 비울 수 없습니다." }, { status: 400 });
  if (body.rotate_board) {
    patch.board_token = crypto.randomUUID();
    patch.board_short_code = newShortCode();
  }
  // 상담실 링크를 한꺼번에 새로 뽑습니다. 문에 붙인 QR이 사진으로 돌았을 때 씁니다 - 옛 QR은
  // 그 순간 닫히고, 새 QR을 다시 붙여야 합니다.
  if (body.rotate_rooms) {
    const { data: rooms, error: rErr } = await s.supabase.from("consult_rooms").select("id").eq("event_id", id);
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    for (const r of (rooms ?? []) as { id: string }[]) {
      const { error: uErr } = await s.supabase
        .from("consult_rooms")
        .update({ room_token: crypto.randomUUID(), room_short_code: newShortCode() })
        .eq("id", r.id);
      if (uErr) return NextResponse.json({ error: `상담실 링크를 새로 만들지 못했습니다: ${uErr.message}` }, { status: 500 });
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await s.supabase.from("consult_events").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * 행사 지우기 — **아직 아무도 상담하지 않은 행사만.** 상담이 한 건이라도 진행됐으면 기록과
 * 메모가 붙어 있어서, 지우면 학생 프로필의 상담 기록까지 함께 사라집니다. 그런 행사는 「종료」로 둡니다.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  if (!s.staff) return staffOnly();

  const { count, error: cErr } = await s.supabase
    .from("consult_status_log")
    .select("id", { count: "exact", head: true })
    .eq("event_id", id);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "이미 상담 기록이 있는 행사는 지울 수 없습니다. 「종료」로 바꿔 주세요." }, { status: 409 });
  }
  const { error } = await s.supabase.from("consult_events").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
