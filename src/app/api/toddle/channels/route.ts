import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { channelKey } from "@/lib/toddleChannel";

export const dynamic = "force-dynamic";

/**
 * 토들 채팅방 ↔ 학생 연결을 저장합니다.
 *
 * 읽기는 화면이 직접 합니다(명부가 이미 화면에 있어서 왕복이 하나 줄어듭니다). 저장만
 * 여기로 모읍니다 — **누가 확인했는지**를 함께 남겨야 하는데, 그 값은 화면이 아니라
 * 서버가 알고 있습니다. 화면이 보내는 이름은 믿을 수 없습니다.
 */

type Body = {
  action?: "link" | "ignore" | "unignore" | "unlink";
  label?: string;
  grades?: string | null;
  studentIds?: string[];
};

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  // 잘못 이으면 학부모 연락이 엉뚱한 아이에게 붙습니다. 그건 화면에 오류로 보이지 않고
  // 「그 아이가 오늘 픽업이래」로 보입니다.
  if (!isAdminUser(me)) return NextResponse.json({ error: "행정·관리자만 채널을 연결할 수 있습니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Body | null;
  const label = (body?.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "채널 이름이 없습니다." }, { status: 400 });

  const supabase = await createClient();
  const who = me.name || me.email || "확인 안 됨";

  // 방 줄이 없으면 만듭니다. 수집기가 아직 안 만든 방을 화면에서 먼저 잇는 경우가 있습니다.
  const { data: existing, error: findErr } = await supabase
    .from("toddle_channels")
    .select("id")
    .eq("label", label)
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: `채널을 읽지 못했습니다: ${findErr.message}` }, { status: 500 });

  let channelId = existing?.id as string | undefined;
  if (!channelId) {
    const { data: made, error: insErr } = await supabase
      .from("toddle_channels")
      .insert({ label, grades: body?.grades ?? null })
      .select("id")
      .single();
    if (insErr) return NextResponse.json({ error: `채널을 만들지 못했습니다: ${insErr.message}` }, { status: 500 });
    channelId = made.id as string;
  }

  if (body?.action === "ignore" || body?.action === "unignore") {
    const ignored = body.action === "ignore";
    const { error } = await supabase
      .from("toddle_channels")
      .update({ ignored, updated_at: new Date().toISOString() })
      .eq("id", channelId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, channelId, ignored });
  }

  if (body?.action === "unlink") {
    // 연결을 지우면 **확인 표시도 함께 지웁니다.** 확인은 「이 아이들이 맞다」는 뜻인데
    // 아이가 없는 확인은 아무 뜻이 없고, 남아 있으면 목록에서 「다 한 방」으로 보입니다.
    const { error: delErr } = await supabase.from("toddle_channel_students").delete().eq("channel_id", channelId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { error } = await supabase
      .from("toddle_channels")
      .update({ confirmed_at: null, confirmed_by: null, updated_at: new Date().toISOString() })
      .eq("id", channelId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, channelId, linked: 0 });
  }

  const studentIds = [...new Set((body?.studentIds ?? []).filter((x) => typeof x === "string" && x))];
  if (studentIds.length === 0) {
    return NextResponse.json({ error: "연결할 학생을 한 명 이상 골라주세요." }, { status: 400 });
  }

  // 통째로 바꿉니다(지우고 새로 넣기). 형제 중 한 명을 뺀 경우가 «덧붙이기»로는 반영되지
  // 않습니다 - 뺐는데 그대로 남아 있으면 화면과 실제가 어긋납니다.
  const { error: clearErr } = await supabase.from("toddle_channel_students").delete().eq("channel_id", channelId);
  if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 });

  const { error: linkErr } = await supabase
    .from("toddle_channel_students")
    .insert(studentIds.map((sid, i) => ({ channel_id: channelId, student_id: sid, seq: i })));
  if (linkErr) return NextResponse.json({ error: `연결하지 못했습니다: ${linkErr.message}` }, { status: 500 });

  const { error: confErr } = await supabase
    .from("toddle_channels")
    .update({
      grades: body?.grades ?? null,
      confirmed_at: new Date().toISOString(),
      confirmed_by: who,
      ignored: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", channelId);
  if (confErr) return NextResponse.json({ error: confErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, channelId, linked: studentIds.length, confirmedBy: who });
}
