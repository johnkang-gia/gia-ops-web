import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { postMessage } from "@/lib/googleChat";
import { toChatText, unmatchedMentions, type ChatMember } from "@/lib/chatMention";

/**
 * 업무화면에서 구글챗 방에 **답장**합니다.
 *
 * 직원들은 구글챗과 토들을 띄워놓고 일합니다. 그래서 업무화면을 띄울 자리가 없고, 자리가
 * 없으니 더 안 쓰게 됩니다. 읽기만 되면 답할 때마다 구글챗을 열어야 해서 창이 하나도 줄지
 * 않습니다 - **답장까지 되어야** 창 하나를 실제로 닫을 수 있습니다.
 *
 * 보내는 계정은 담당자 한 분의 계정입니다(연동에 쓴 그 계정). 그래서 방에는 그분 이름으로
 * 나갑니다 - 누가 눌렀는지는 본문 앞에 붙여 남깁니다. 안 붙이면 받는 선생님은 늘 같은
 * 사람이 답한 것으로 읽고, 되물을 때 엉뚱한 사람을 찾습니다.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const spaceId = String(body?.spaceId ?? "").trim();
  const text = String(body?.text ?? "").trim();
  const threadName = String(body?.threadName ?? "").trim() || null;
  if (!spaceId) return NextResponse.json({ error: "어느 방인지 알 수 없습니다." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "보낼 내용이 비어 있습니다." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // @이름 → 사람 번호.
  //
  // 구글챗에서 멘션은 글자가 아니라 번호입니다. 글자로 보내면 **보낸 쪽은 불렀다고 생각하고
  // 받는 쪽은 알림을 못 받습니다.** 못 바꾼 이름은 함께 돌려줘서 화면이 알려주게 합니다.
  const { data: members } = await supabase
    .from("google_chat_members")
    .select("google_user_id, display_name")
    .eq("google_space_id", spaceId);
  const list = (members as ChatMember[] | null) ?? [];
  const body2 = toChatText(text, list);
  const unmatched = unmatchedMentions(text, list);

  // 누가 답했는지 본문에 남깁니다. 보내는 계정은 하나뿐이라, 이게 없으면 받는 쪽에서
  // 「행정실」이 아니라 «그 한 사람»이 늘 답하는 것처럼 보입니다.
  const who = me.name || me.email.split("@")[0];
  const sent = await postMessage(supabase, spaceId, `[${who}] ${body2}`, threadName);
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });

  return NextResponse.json({ ok: true, unmatched });
}
