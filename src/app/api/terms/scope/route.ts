import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentAppUser } from "@/lib/currentUser";
import { TERM_COOKIE } from "@/lib/termScope";

// 보고 있는 학기를 바꿉니다.
//
// 쿠키에 담는 이유는 서버에서 그리는 화면들이 같은 값을 읽어야 하기 때문입니다. 브라우저
// 저장소는 서버가 못 읽습니다.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { termId } = (await req.json().catch(() => ({}))) as { termId?: string };
  const jar = await cookies();
  if (!termId) jar.delete(TERM_COOKIE);
  else jar.set(TERM_COOKIE, termId, { path: "/", maxAge: 60 * 60 * 24 * 180, sameSite: "lax" });
  return NextResponse.json({ ok: true });
}
