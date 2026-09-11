import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";

/**
 * 오류 묶음을 「해결했다」고 표시합니다.
 *
 * **되돌리는 창구는 없습니다.** 잘못 눌렀다면 그 오류는 또 날 것이고, 또 나면 화면이
 * 저절로 미해결로 되돌립니다. 사람이 되돌릴 단추를 두면 「지워서 안 보이게 하는 길」이
 * 생기는데, 안 보이는 오류는 없는 오류가 아닙니다.
 *
 * 표시를 고쳐 쓰는 것(메모 수정·다시 확인)은 같은 줄을 덮어씁니다.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isDeveloperEmail(me.email)) return NextResponse.json({ error: "개발자만 쓸 수 있습니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    fingerprint?: string;
    route?: string;
    sampleMessage?: string;
    note?: string;
  } | null;

  const fingerprint = (body?.fingerprint ?? "").trim();
  if (!fingerprint) return NextResponse.json({ error: "어느 오류인지가 없습니다." }, { status: 400 });

  const supabase = await createClient();
  const resolvedAt = new Date().toISOString();
  const { error } = await supabase.from("error_resolutions").upsert(
    {
      fingerprint,
      route: (body?.route ?? "").slice(0, 200) || null,
      sample_message: (body?.sampleMessage ?? "").slice(0, 2000) || null,
      resolved_at: resolvedAt,
      resolved_by: me.name || me.email,
      note: (body?.note ?? "").trim().slice(0, 500) || null,
    },
    { onConflict: "fingerprint" },
  );
  // 조용히 성공한 척하지 않습니다. 표시가 안 됐는데 화면에서 사라지면, 다음 사람은 이미
  // 고친 오류인 줄 압니다.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, resolvedAt });
}
