import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { saveTermSnapshot } from "@/lib/termSnapshot";
import { logApiError } from "@/lib/logging";

// 지금의 반·담임·과목 세팅을 이 학기 기록으로 저장합니다.
//
// 평소에는 학기 종료 크론이 알아서 떠줍니다. 이 버튼은 두 경우에 씁니다.
//   · 학기가 아직 안 끝났는데 지금 모습을 남겨두고 싶을 때
//   · 이미 종료된 학기인데 크론이 돌기 전에 세팅을 바꿔버렸을 때(그때는 이미 늦었지만,
//     적어도 지금 모습이라도 남습니다)

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const body = (await req.json()) as { termId?: string; note?: string };
    if (!body.termId) return NextResponse.json({ error: "termId가 필요합니다." }, { status: 400 });

    const res = await saveTermSnapshot(supabase, body.termId, {
      takenBy: me.name ?? me.email,
      source: "수동",
      note: body.note ?? null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error ?? "저장하지 못했습니다." }, { status: 400 });
    return NextResponse.json({ ok: true, classes: res.classes, subjects: res.subjects });
  } catch (err) {
    await logApiError(supabase, "api:school/term-snapshot", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
