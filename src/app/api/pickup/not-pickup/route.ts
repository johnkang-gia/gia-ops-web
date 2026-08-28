import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { logApiError } from "@/lib/logging";

// "이 연락은 픽업이 아닙니다" — 사람이 AI 판단을 바로잡는 창구.
//
// 담당자: "판단 근거를 수정해서 학습시키고 싶은데, 하원체크표에서 물음표로 근거 창이 나올 때
//          학습시킬 수 있도록 해줘."
//
// 그리고 실제로 틀린 예를 두 개 주셨습니다.
//   · "선생님 55분 도착입니다^^"      → 아이를 데려간다는 말이 없는데 픽업으로 잡힘
//   · "첼로 가지러 오피스로 갈게요"   → 가지러 가는 대상이 물건인데 픽업으로 잡힘
//
// 체크표에서 표시만 지우면 오늘 하루만 고쳐집니다. **원래 연락이 그대로 남아 내일 또
// 올라옵니다.** 사람은 같은 것을 매일 지우게 되고, 그러다 지치면 그냥 둡니다.
// 그래서 여기서는 연락 자체를 되돌리고, 그 정정을 다음 판단에 쓰도록 남깁니다.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const me = await getCurrentAppUser();
    if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { requestId?: string; studentName?: string } | null;
    const requestId = (body?.requestId ?? "").trim();
    if (!requestId) return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });

    const { data: row, error: readErr } = await supabase
      .from("pickup_requests")
      .select("id, sender_name, channel_label, kind, raw_text")
      .eq("id", requestId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return NextResponse.json({ error: "그 연락을 찾지 못했습니다." }, { status: 404 });

    // ① 이 연락을 '무시'로. 체크표·대시보드는 무시된 것을 읽지 않습니다.
    const { error: updErr } = await supabase
      .from("pickup_requests")
      .update({
        status: "무시",
        kind: "문의", // 픽업이 아니라 문의였다는 뜻. 문의함에는 그대로 남아 답을 놓치지 않습니다.
        ai_is_pickup: false,
        resolved_by: me.email,
        resolved_at: new Date().toISOString(),
        ai_note: `사람이 '픽업 아님'으로 정정 (${me.name ?? me.email})`,
      })
      .eq("id", requestId);
    if (updErr) throw updErr;

    // ② 발신자별 정정 기록.
    //
    // 이 값이 쌓이면 같은 발신자의 다음 픽업 판단에서 신뢰도를 낮춰(pickupIngest.ts) 자동
    // 확정 대신 사람 확인으로 넘깁니다. 같은 실수를 두 번 하지 않게 하는 자리입니다.
    const senderKey = ((row.sender_name as string | null) ?? (row.channel_label as string | null) ?? "").trim();
    if (senderKey) {
      const { data: fb } = await supabase
        .from("pickup_sender_feedback")
        .select("not_pickup_count")
        .eq("sender_key", senderKey)
        .maybeSingle();
      const next = ((fb?.not_pickup_count as number | null) ?? 0) + 1;
      await supabase
        .from("pickup_sender_feedback")
        .upsert({ sender_key: senderKey, not_pickup_count: next, updated_at: new Date().toISOString() }, { onConflict: "sender_key" });
    }

    // ③ 이 연락에서 만들어진 출결 등록도 함께 내립니다.
    //    남겨두면 대시보드에는 계속 뜹니다 - 한 곳만 고치면 다른 곳이 어긋납니다.
    await supabase
      .from("attendance_entries")
      .update({ state: "무시", touched_by_human: true, note: "사람이 '픽업 아님'으로 정정" })
      .eq("source_message_id", requestId);

    return NextResponse.json({ ok: true, senderKey: senderKey || null });
  } catch (err) {
    await logApiError(supabase, "pickup:not-pickup", err);
    return NextResponse.json({ error: "처리하지 못했습니다." }, { status: 500 });
  }
}
