import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { logApiError } from "@/lib/logging";

/**
 * **「아님」을 잘못 눌렀을 때 되돌립니다.**
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * ✕ 를 누르면 연락이 「무시」가 되고 목록에서 처리 단추가 사라집니다. 그런데 되돌리는 길이
 * 없었습니다 - 옆 줄을 누르려다 빗나간 한 번으로 그 아이의 결석 연락이 묻혔고, 화면에는
 * 오류가 아니라 「처리된 것」으로 보였습니다.
 *
 * 되돌릴 수 없는 단추는 사람을 조심스럽게 만드는 것이 아니라 **안 누르게** 만듭니다. 그러면
 * 틀린 자동 판정이 계속 쌓입니다.
 *
 * ── 되돌리는 것과 되돌리지 않는 것 ──────────────────────────────────────────
 *
 * 되돌립니다: 연락의 상태·종류(`undo_state` 에 담아 둔 누르기 직전 값), 그리고 발신자
 * 정정 횟수 하나.
 *
 * **되돌리지 않습니다: 체크표·출결 등록·픽업 업무.** 「아님」을 누른 뒤 다른 사람이 그 아이를
 * 직접 체크했을 수 있고, 그 위에 옛 값을 덮으면 오늘 명단이 조용히 바뀝니다. 대신 연락이
 * 처리 단추와 함께 목록으로 돌아오므로 그 자리에서 한 번 더 누르면 됩니다 - 화면도 그렇게
 * 적습니다. 반쯤 되돌린 것을 「되돌렸다」고 말하지 않습니다.
 */

export const dynamic = "force-dynamic";

type UndoState = { status?: string | null; kind?: string | null; ai_is_pickup?: boolean | null };

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const me = await getCurrentAppUser();
    if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { requestId?: string } | null;
    const requestId = (body?.requestId ?? "").trim();
    if (!requestId) return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });

    const { data: row, error: readErr } = await supabase
      .from("pickup_requests")
      .select("id, sender_name, channel_label, undo_state")
      .eq("id", requestId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return NextResponse.json({ error: "그 연락을 찾지 못했습니다." }, { status: 404 });

    const prev = (row.undo_state as UndoState | null) ?? null;
    if (!prev) {
      // 「되돌릴 것이 없다」와 「되돌리다 실패했다」를 구별해서 말합니다.
      return NextResponse.json(
        { error: "되돌릴 기록이 없습니다. 이 연락은 ✕로 내린 것이 아니거나, 이미 되돌렸습니다." },
        { status: 409 },
      );
    }

    const { error: updErr } = await supabase
      .from("pickup_requests")
      .update({
        status: prev.status ?? "확인필요",
        kind: prev.kind ?? null,
        ai_is_pickup: prev.ai_is_pickup ?? null,
        resolved_by: me.email,
        resolved_at: new Date().toISOString(),
        ai_note: `사람이 '아님'을 되돌렸습니다 (${me.name ?? me.email})`,
        // 비웁니다. 남겨 두면 「되돌릴 수 있는 것」과 「이미 되돌린 것」이 똑같이 보입니다.
        undo_state: null,
      })
      .eq("id", requestId);
    if (updErr) throw updErr;

    // 발신자 정정 횟수도 함께 내립니다. 안 내리면 잘못 누른 한 번 때문에 그 학부모의
    // 다음 연락이 계속 사람 확인으로 넘어갑니다.
    const senderKey = ((row.sender_name as string | null) ?? (row.channel_label as string | null) ?? "").trim();
    if (senderKey) {
      const { data: fb } = await supabase
        .from("pickup_sender_feedback")
        .select("not_pickup_count")
        .eq("sender_key", senderKey)
        .maybeSingle();
      const next = Math.max(0, ((fb?.not_pickup_count as number | null) ?? 0) - 1);
      await supabase
        .from("pickup_sender_feedback")
        .upsert({ sender_key: senderKey, not_pickup_count: next, updated_at: new Date().toISOString() }, { onConflict: "sender_key" });
    }

    return NextResponse.json({
      ok: true,
      restored: { status: prev.status ?? "확인필요", kind: prev.kind ?? null },
      // 화면이 이 문장을 그대로 띄웁니다. 「되돌렸다」만 말하고 넘어가면, 체크표에 다시
      // 걸린 줄 알고 아무도 다시 안 누릅니다.
      note: "연락을 목록으로 되돌렸습니다. 하원 체크표·출결 등록은 다시 걸지 않았습니다 — 필요하면 결석·픽업·탑승을 다시 눌러주세요.",
    });
  } catch (err) {
    await logApiError(supabase, "pickup:restore", err);
    return NextResponse.json({ error: "되돌리지 못했습니다." }, { status: 500 });
  }
}
