import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser, type CurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";

/**
 * **상담 화면의 권한 — 한 자리.**
 *
 *   행정실 이상  명단·상담실·설정을 고치고, 모든 예약의 상태를 바꿉니다(안내데스크).
 *   선생님      어느 상담실이든 호출·시작·종료·지연·되돌리기와 메모(면담자). 그날 어느 선생님이
 *               어느 방에 들어갈지 미리 알 수 없어서 방으로 막지 않습니다.
 *   상담실 링크  로그인 없이 그 방 하나만(태블릿·QR, `/api/consult/room/[token]`).
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

/** 현황판 짧은 주소. 헷갈리는 글자(0·o·1·l)를 뺀 8자 - 전자칠판에서 손으로 칩니다. */
export function newShortCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
