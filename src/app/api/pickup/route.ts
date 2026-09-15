import { NextResponse } from "next/server";
import { undoInquiryNotes, undoPickupTraces, undoSummary } from "@/lib/pickupUndo";
import { isClockTime, isNoteKind } from "@/lib/studentDayNotes";
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
      .select("id, service_date, student_id, raw_text, source, channel_label, sender_name, source_url")
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
    // 사람이 인박스에서 확정한 것이라 「누가」는 분명합니다. 그래도 **근거 원문**을 함께
    // 남깁니다 - 며칠 뒤 기록을 보는 사람에게는 「누가 눌렀다」만으로 왜 픽업인지 알 수
    // 없고, 그 연락은 인박스에서 이미 정리됐을 수 있습니다.
    const applied = await applyPickup(supabase, finalStudentId, row.service_date as string, me.name || me.email, {
      text: ((row.raw_text as string | null) ?? "").trim() || "인박스에서 사람이 직접 픽업으로 확정했습니다.",
      source: (row.source as string | null) ?? "토들",
      from: (row.channel_label as string | null) ?? (row.sender_name as string | null) ?? null,
      url: (row.source_url as string | null) ?? null,
    });

    // **특이사항으로 잘못 넘겼던 것을 되돌립니다.** 안 내리면 그 아이는 보드에서 픽업이면서
    // 동시에 약을 먹는 아이가 되고, 어느 쪽이 지금 맞는지 화면으로는 알 수 없습니다.
    const notes = await undoInquiryNotes(supabase, id, { email: me.email, name: me.name ?? null });
    return NextResponse.json({
      ok: true,
      applied,
      notesDropped: notes.notes,
      problems: notes.problems,
    });
  }

  // ── 픽업이 아니라 **특이사항**으로 확정 ───────────────────────────────────
  //
  // 토들로 오는 연락은 픽업·결석·지각만이 아닙니다. 「약 좀 챙겨주세요」·「오늘 결제할게요」
  // 같은 글에 대해 이 화면이 할 수 있는 일은 「픽업 아님」뿐이었고, 그러면 그 부탁은
  // **아무 데도 안 남은 채** 인박스에서 사라졌습니다.
  //
  // 순서가 중요합니다. 인박스에서 내리는 일(undoPickupTraces)이 **특이사항을 넣기 전에**
  // 끝나야 합니다 - 반대로 하면 방금 넣은 줄을 그 되돌리기가 다시 내립니다.
  if (action === "note") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const kind = isNoteKind(body?.kind) ? body.kind : "기타";
    const content = ((body?.content as string | undefined) ?? "").trim();
    const rawTime = ((body?.atTime as string | undefined) ?? "").trim();
    if (!content) return NextResponse.json({ error: "무엇을 해야 하는지 적어주세요." }, { status: 400 });
    if (content.length > 300) return NextResponse.json({ error: "내용은 300자까지입니다." }, { status: 400 });
    // 못 읽는 시각이 들어가면 알람이 그 줄만 조용히 건너뜁니다. 사람은 적어뒀다고 믿습니다.
    if (rawTime && !isClockTime(rawTime)) return NextResponse.json({ error: "시각은 14:30 처럼 적어주세요." }, { status: 400 });

    const { data: row } = await supabase
      .from("pickup_requests")
      .select("id, service_date, student_id, status")
      .eq("id", id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });

    const studentId = ((body?.studentId as string | undefined) ?? (row.student_id as string | null)) || null;
    if (!studentId) return NextResponse.json({ error: "학생을 먼저 선택해주세요." }, { status: 400 });

    // 이름은 **명부에서** 읽습니다. 화면이 보낸 이름을 믿으면 김재이가 셋이라 나중에 어느
    // 아이 것인지 되짚을 수 없습니다(CLAUDE.md §2-4-1).
    const { data: student, error: stuErr } = await supabase
      .from("wr_students")
      .select("name")
      .eq("is_demo", false)
      .eq("id", studentId)
      .maybeSingle();
    if (stuErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${stuErr.message}` }, { status: 500 });
    if (!student) return NextResponse.json({ error: "명부에 없는 학생입니다. 다시 골라주세요." }, { status: 400 });

    const onDate = ((body?.onDate as string | undefined) ?? "").trim() || ((row.service_date as string | null) ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return NextResponse.json({ error: "날짜 모양이 올바르지 않습니다." }, { status: 400 });

    const before = (row.status as string | null) ?? "확인대기";
    const { error: stErr } = await supabase
      .from("pickup_requests")
      .update({ student_id: studentId, status: "무시", resolved_by: me.email, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });

    // 픽업이 아니었다고 알려줍니다. 이 정정이 쌓여야 다음부터 같은 집 연락을 덜 잘못 읽습니다.
    await bumpPickupFeedback(supabase, id, false);
    const undo = await undoPickupTraces(supabase, id, { email: me.email, name: me.name ?? null });

    const { data: note, error: noteErr } = await supabase
      .from("student_day_notes")
      .insert({
        student_id: studentId,
        student_name: (student as { name: string }).name,
        on_date: onDate,
        at_time: rawTime || null,
        kind,
        content,
        source_inquiry_id: id,
        created_by: me.email,
        created_by_name: me.name || me.email,
      })
      .select("id")
      .single();

    if (noteErr) {
      // **못 적었으면 인박스에서도 내리지 않습니다.** 내려간 채로 실패하면 그 부탁은 어디에도
      // 안 남고, 화면에는 처리된 것처럼 보입니다.
      await supabase.from("pickup_requests").update({ status: before, resolved_by: null, resolved_at: null }).eq("id", id);
      return NextResponse.json({ error: `특이사항을 저장하지 못했습니다: ${noteErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      noteId: (note as { id: string }).id,
      name: (student as { name: string }).name,
      undo,
      undoNote: undoSummary(undo),
    });
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

    // **인박스에서 내렸으면 체크표·출결·업무에서도 내려갑니다.**
    //
    // 앞 판은 여기서 인박스 목록만 고쳤습니다. 그런데 확정할 때 체크표에도 픽업 줄이
    // 찍히고, 중앙 대시보드는 체크표를 가장 세게 읽습니다 - 지운 아이가 대시보드에
    // 계속 떴습니다. 한 곳만 고치면 다른 곳이 어긋납니다.
    const undo = await undoPickupTraces(supabase, id, { email: me.email, name: me.name ?? null });
    return NextResponse.json({ ok: true, undo, undoNote: undoSummary(undo) });
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
