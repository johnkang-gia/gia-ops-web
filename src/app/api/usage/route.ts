import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { sanitizeEvent, type UsageEventIn } from "@/lib/usageTrack";

/**
 * **이용 기록을 받는 자리.**
 *
 * ── 왜 서버를 거치나 ────────────────────────────────────────────────────────
 *
 * 브라우저에서 표에 바로 넣게 하면 **남의 이메일로 아무 기록이나 넣을 수 있습니다.** 그러면
 * 이 표의 숫자를 아무도 못 믿고, 못 믿는 숫자는 없는 것과 같습니다. 그래서 «누가»는 화면이
 * 보내는 값이 아니라 **서버가 세션에서 읽은 값**입니다.
 *
 * ── 조용히 실패해도 되는 유일한 자리 ────────────────────────────────────────
 *
 * 이 저장소의 규칙은 「조용한 실패 금지」입니다(CLAUDE.md 5). 여기는 예외로 둡니다 -
 * 이용 기록이 안 쌓인 것 때문에 사람이 하려던 일이 막히면 본말전도입니다. 대신 **안 쌓이고
 * 있다는 사실은 화면에 드러납니다**: [개발자 → 이용 기록]이 「최근 기록 없음」을 적습니다.
 */

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  const userDb = await createClient();
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: true, skipped: "no-session" });

  const me = await getCurrentAppUser();
  const email = (me?.email ?? auth.user.email ?? "").toLowerCase();
  if (!email) return NextResponse.json({ ok: true, skipped: "no-email" });

  const body = (await req.json().catch(() => null)) as { events?: UsageEventIn[] } | null;
  const raw = Array.isArray(body?.events) ? body!.events : [];
  // 한 번에 스무 줄까지. 그보다 많이 오면 화면 쪽이 잘못 돌고 있는 것이고, 그대로 받으면
  // 표가 하루 만에 부풀어 정작 보고 싶은 숫자를 못 뽑습니다.
  const events = raw.slice(0, 20).map(sanitizeEvent).filter((e) => e.path);
  if (events.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

  const db = serviceClient();
  if (!db) return NextResponse.json({ ok: true, skipped: "no-service-key" });

  const { error } = await db.from("usage_events").insert(
    events.map((e) => ({
      ...e,
      user_email: email,
      user_name: me?.name ?? null,
      // 직위는 **그 순간의 값**을 굳힙니다. 나중에 직위가 바뀌어도 그때 그 사람이 어떤
      // 자리에서 썼는지 알아야 합니다.
      position: me?.position ?? null,
    })),
  );
  if (error) {
    // 사람이 하려던 일을 막지 않되, 서버 기록에는 남깁니다.
    console.error("[usage] 기록하지 못했습니다:", error.message);
    return NextResponse.json({ ok: true, inserted: 0, note: error.message });
  }
  return NextResponse.json({ ok: true, inserted: events.length });
}
