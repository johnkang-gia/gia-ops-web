import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * **이 결석이 어디서 왔는가** — 근거 원문을 돌려줍니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 *
 * 출석부에 「확인」이 붙은 줄은 연락에서 저절로 들어온 것입니다. 그런데 화면에는 그 사실만
 * 있고 **무엇을 보고 그렇게 판단했는지**가 없었습니다. 확인하려면 업무보드로 건너가 인박스를
 * 뒤지거나, 구글챗·토들을 따로 열어 찾아야 했습니다.
 *
 * 그러면 사람은 확인하지 않고 그냥 넘깁니다. 확인하지 않은 「확인」은 아무 뜻이 없고,
 * 자동이 잘못 읽은 결석이 그대로 굳습니다 - 결석은 상급학교 서류에 남는 값입니다.
 *
 * ── 왜 서버를 거치나 ─────────────────────────────────────────────────
 *
 * 구글챗 미러(google_chat_mirror_messages)는 RLS가 닫혀 있어 사용자 토큰으로는 못 읽습니다.
 * attendance_entries.raw_text 에도 원문이 있지만 **500자에서 잘려 있습니다.** 잘린 글을
 * 근거라고 보여주면, 뒤쪽에 「아니 취소요」가 적혀 있어도 알 수 없습니다.
 */

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const userDb = await createClient();
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const entryId = req.nextUrl.searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId가 필요합니다." }, { status: 400 });

  const db = serviceClient();
  if (!db) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });

  const { data: entry, error } = await db
    .from("attendance_entries")
    .select("id, source, source_message_id, student_name, status, date_from, date_to, reason, note, raw_text, registered_by, registered_at, created_at")
    .eq("id", entryId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!entry) {
    // 없어졌다는 사실을 그대로 알립니다. 빈 창을 띄우면 「근거가 없는 결석」과
    // 「근거를 못 찾은 화면」이 똑같이 보입니다.
    return NextResponse.json({ error: "근거가 된 연락을 찾지 못했습니다. 지워졌을 수 있습니다." }, { status: 404 });
  }

  // 원문. 잘리지 않은 전체를 가져옵니다.
  let full: {
    text: string;
    sender: string | null;
    at: string | null;
    channel: string | null;
  } | null = null;

  if (entry.source === "googlechat" && entry.source_message_id) {
    const { data: m } = await db
      .from("google_chat_mirror_messages")
      .select("content, sender_display_name, sender_email, created_at_google, source_key")
      .eq("id", entry.source_message_id)
      .maybeSingle();
    if (m) {
      full = {
        text: (m.content as string | null) ?? "",
        sender: (m.sender_display_name as string | null) ?? (m.sender_email as string | null) ?? null,
        at: (m.created_at_google as string | null) ?? null,
        channel: (m.source_key as string | null) ?? "구글챗",
      };
    }
  } else if (entry.source === "toddle" && entry.source_message_id) {
    const { data: r } = await db
      .from("pickup_requests")
      .select("raw_text, summary, channel_name, received_at")
      .eq("id", entry.source_message_id)
      .maybeSingle();
    if (r) {
      full = {
        text: ((r.raw_text as string | null) ?? (r.summary as string | null) ?? "").toString(),
        sender: null,
        at: (r.received_at as string | null) ?? null,
        channel: (r.channel_name as string | null) ?? "토들",
      };
    }
  }

  return NextResponse.json(
    { ok: true, entry, full },
    { headers: { "Cache-Control": "no-store" } },
  );
}
