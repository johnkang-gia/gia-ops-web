import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

/**
 * **화면에 떴다 사라진 오류를 남깁니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 화면 오른쪽 아래에 빨간 알림이 떴다가 5초 뒤 사라집니다. 그게 끝이었습니다.
 * 담당자가 「방금 뭔가 오류가 났는데」라고 해도 **아무 데도 안 남아 있어서** 무엇이
 * 났는지 물어볼 곳이 없었습니다.
 *
 * 서버에서 난 오류는 `logApiError` 가 오류 목록에 남깁니다. 그런데 **화면에서 난 오류**
 * (저장 실패, 권한 없음, 읽기 실패)는 알림으로만 떴습니다. 사람이 실제로 보는 오류는
 * 대부분 이쪽인데, 기록되는 것은 저쪽뿐이었습니다.
 *
 * ── 무엇을 조심했나 ──────────────────────────────────────────────────
 *
 * **기록하다가 화면을 막지 않습니다.** 이 창구가 실패해도 알림은 이미 떠 있고, 사람이
 * 하려던 일과는 상관이 없습니다. 그래서 실패해도 조용히 넘어갑니다 - 오류를 기록하려다
 * 오류를 하나 더 만드는 것은 뒤바뀐 일입니다.
 */

type Body = { message?: string; where?: string };

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  // 로그인 안 한 화면(안내보드·도착체크)은 여기로 안 보냅니다. 토큰 화면의 오류까지
  // 받으면 링크만 아는 사람이 오류 목록을 채울 수 있습니다.
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  const message = (body?.message ?? "").trim();
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("error_logs").insert({
    // 어느 화면에서 났는지가 고치는 데 가장 중요한 재료입니다.
    route: `화면:${(body?.where ?? "알 수 없음").slice(0, 120)}`,
    message: message.slice(0, 2000),
    stack: null,
    user_email: me.email ?? null,
  });
  if (error) {
    // 남기지 못한 것까지 조용히 넘기지는 않습니다 - 서버 로그에는 남깁니다.
    console.error("[errors] 화면 오류를 기록하지 못했습니다:", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
