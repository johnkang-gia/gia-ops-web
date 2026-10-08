import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser, type CurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";

/**
 * **상담 화면의 권한 — 한 자리.**
 *
 *   행정실 이상  명단·상담실·설정을 고치고, 모든 예약의 상태를 바꿉니다(안내데스크).
 *   선생님      **자기 상담실**(teacher_email 이 자기 계정인 방)에 온 예약만 호출·시작·종료하고
 *               메모를 남깁니다(면담자).
 *
 * 화면에서 단추를 숨기는 것은 예의이고, 여기서 다시 보는 것이 자물쇠입니다(CLAUDE.md §2-8).
 */

type Me = NonNullable<CurrentAppUser>;
type Supa = Awaited<ReturnType<typeof createClient>>;

export async function consultSession(): Promise<
  { ok: true; me: Me; supabase: Supa; staff: boolean } | { ok: false; res: NextResponse }
> {
  const me = await getCurrentAppUser();
  if (!me) return { ok: false, res: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const supabase = await createClient();
  return { ok: true, me, supabase, staff: isStaffOrAboveUser(me) };
}

export function staffOnly(): NextResponse {
  return NextResponse.json({ error: "행정실 이상만 할 수 있는 일입니다." }, { status: 403 });
}

/** 이 선생님이 이 예약을 다룰 수 있는가 — 지금 방이나 코스의 방 중 하나가 자기 방이면. */
export async function teacherOwnsAppt(supabase: Supa, email: string, apptId: string): Promise<boolean> {
  const { data: appt } = await supabase
    .from("consult_appointments")
    .select("event_id, room_id, course_room_ids")
    .eq("id", apptId)
    .maybeSingle();
  if (!appt) return false;
  const a = appt as { event_id: string; room_id: string | null; course_room_ids: string[] | null };
  const ids = [a.room_id, ...(a.course_room_ids ?? [])].filter((v): v is string => !!v);
  if (ids.length === 0) return false;
  const { data: rooms } = await supabase.from("consult_rooms").select("teacher_email").in("id", ids);
  const mine = email.toLowerCase();
  return ((rooms ?? []) as { teacher_email: string | null }[]).some((r) => (r.teacher_email ?? "").toLowerCase() === mine);
}

/** 현황판 짧은 주소. 헷갈리는 글자(0·o·1·l)를 뺀 8자 - 전자칠판에서 손으로 칩니다. */
export function newShortCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
