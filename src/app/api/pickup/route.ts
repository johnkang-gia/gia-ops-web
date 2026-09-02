import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { applyPickup, ingestPickup, loadRoster } from "@/lib/pickupIngest";
import { kstParts } from "@/lib/shuttleTracking";

export const dynamic = "force-dynamic";

// 픽업/픽업아님 정정을 발신자별로 학습에 누적합니다(요청 ⑩). 발신자 키는 어머니 성함,
// 없으면 채널 라벨을 씁니다. 이 이력은 ingest 분류의 신뢰도(자동확정)에 반영됩니다.
async function bumpPickupFeedback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  isPickup: boolean
) {
  const { data } = await supabase.from("pickup_requests").select("sender_name, channel_label").eq("id", id).maybeSingle();
  const sender = ((data?.sender_name as string | null) || (data?.channel_label as string | null) || "").trim();
  if (!sender) return;
  await supabase.rpc("bump_pickup_feedback", { p_sender: sender, p_is_pickup: isPickup });
}

// 픽업 인박스에서 담당자가 누르는 버튼들이 오는 곳입니다.
// 여기는 로그인한 교직원만 쓰며(수집기가 쓰는 /api/pickup/ingest와 인증 방식이 다릅니다),
// 누가 확정했는지 기록에 남깁니다.

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me || !isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = await createClient();
  const body = await req.json().catch(() => null);
  const action = body?.action as string | undefined;

  // ── 확인 대기 건을 픽업으로 확정 ──────────────────────────────────────────
  // 학생을 바꿔서 확정할 수도 있습니다(AI가 형제 중 다른 아이로 잡았을 때).
  if (action === "confirm") {
    const id = body?.id as string | undefined;
    const studentId = (body?.studentId as string | undefined) ?? null;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const { data: row } = await supabase
      .from("pickup_requests")
      .select("id, service_date, student_id")
      .eq("id", id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });

    const finalStudentId = studentId ?? (row.student_id as string | null);
    if (!finalStudentId) return NextResponse.json({ error: "학생을 먼저 선택해주세요." }, { status: 400 });

    let matchedName: string | null = null;
    const { data: student } = await supabase.from("wr_students").select("name").eq("is_demo", false).eq("id", finalStudentId).maybeSingle();
    if (student) matchedName = student.name as string;

    const { error } = await supabase
      .from("pickup_requests")
      .update({
        student_id: finalStudentId,
        matched_name: matchedName,
        status: "확정",
        resolved_by: me.email,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await bumpPickupFeedback(supabase, id, true);
    const applied = await applyPickup(supabase, finalStudentId, row.service_date as string);
    return NextResponse.json({ ok: true, applied });
  }

  // ── 픽업이 아니라고 표시 ──────────────────────────────────────────────────
  if (action === "ignore") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const { error } = await supabase
      .from("pickup_requests")
      .update({ status: "무시", resolved_by: me.email, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await bumpPickupFeedback(supabase, id, false);
    return NextResponse.json({ ok: true });
  }

  // ── 손으로 붙여넣어 접수 ──────────────────────────────────────────────────
  // 전화로 받은 내용, 교사가 전달한 내용, 통화 녹취 텍스트를 그대로 붙여넣으면 AI가 같은
  // 방식으로 판단합니다. 여러 명이 섞인 긴 글도 한 번에 넣을 수 있게 줄 단위로 나눠 처리합니다.
  if (action === "manual") {
    const text = (body?.text as string | undefined)?.trim();
    const source = (body?.source as "전화" | "교사" | "직접입력" | undefined) ?? "직접입력";
    if (!text) return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });

    const roster = await loadRoster(supabase);
    // 빈 줄로 문단을 나눕니다. 한 문단이 한 건입니다 - 줄바꿈 하나로 나누면 한 사람의 말이
    // 여러 건으로 쪼개집니다.
    const blocks = text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 20);

    const results = [];
    for (const block of blocks) {
      results.push(
        await ingestPickup(
          supabase,
          { source, text: block, senderName: (body?.senderName as string | undefined) ?? null },
          roster
        )
      );
    }
    return NextResponse.json({ ok: true, results });
  }

  // ── 오늘 인박스 다시 읽기 ─────────────────────────────────────────────────
  if (action === "list") {
    const today = kstParts(new Date()).iso;
    const { data, error } = await supabase
      .from("pickup_requests")
      .select("*")
      .gte("service_date", today)
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, rows: data ?? [] });
  }

  return NextResponse.json({ error: "알 수 없는 action입니다." }, { status: 400 });
}
