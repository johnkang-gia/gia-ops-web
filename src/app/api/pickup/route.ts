import { NextResponse } from "next/server";
import { undoInquiryNotes, undoPickupTraces, undoSummary } from "@/lib/pickupUndo";
import { isClockTime, isNoteKind } from "@/lib/studentDayNotes";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { applyBoarding, applyPickup, ingestPickup, loadRoster } from "@/lib/pickupIngest";
import { weekStartOf } from "@/lib/dismissalWeek";
import { todayKst } from "@/lib/kst";
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

  // ── 오늘만 셔틀 탑승 (픽업의 반대) ────────────────────────────────────────
  //
  // 백서아는 수요일에 셔틀을 안 탑니다(하원수단: 블루웨일버스). 그래서 아침 크론이 체크표에서
  // 빼고 「픽업」으로 찍습니다. 그날 학부모가 「오늘 서아 셔틀로 하원부탁드립니다」라고 보내면
  // **그 기본을 오늘만 뒤집어야** 하는데, 인박스에는 그 갈래가 없어 글이 문의로만 남고
  // 체크표는 여전히 픽업이었습니다 - 화면에 적힌 답이 **정반대**이고, 그대로 두면 아이가
  // 셔틀을 못 탑니다.
  //
  // **판정은 한 곳에서만 합니다**(CLAUDE.md §2-11). 「오늘 이 아이가 무엇을 타는가」는
  // `student_dismissal_plans` 를 `loadDismissalForDay` 가 읽어 정하므로, 여기서도 그 표에
  // **이번 주만 유효한 줄**을 넣습니다. 체크표·셔틀명단·도착체크·크론이 전부 그 답을
  // 따라옵니다 - 화면마다 따로 고치면 언젠가 한 화면만 옛 답을 냅니다.
  if (action === "ride-shuttle") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const { data: row } = await supabase
      .from("pickup_requests")
      .select("id, service_date, student_id, raw_text, source, channel_label, sender_name, source_url, status")
      .eq("id", id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });

    const studentId = ((body?.studentId as string | undefined) ?? (row.student_id as string | null)) || null;
    if (!studentId) return NextResponse.json({ error: "학생을 먼저 선택해주세요." }, { status: 400 });

    const { data: student, error: stuErr } = await supabase
      .from("wr_students")
      .select("name")
      .eq("is_demo", false)
      .eq("id", studentId)
      .maybeSingle();
    if (stuErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${stuErr.message}` }, { status: 500 });
    if (!student) return NextResponse.json({ error: "명부에 없는 학생입니다." }, { status: 400 });
    const name = (student as { name: string }).name;

    // **오늘 것만** 뒤집습니다. 며칠 뒤 것을 이 단추로 바꾸면 그날 아침에 아무도 모릅니다.
    const day = ((row.service_date as string | null) ?? todayKst());
    if (day !== todayKst()) {
      return NextResponse.json({ error: "오늘 연락만 여기서 바꿀 수 있습니다. 다른 날은 학생 프로필의 하원수단에서 고쳐주세요." }, { status: 400 });
    }
    const weekday = new Date(`${day}T12:00:00+09:00`).getDay();
    if (weekday === 0 || weekday === 6) {
      return NextResponse.json({ error: "주말에는 하원 차량이 없습니다." }, { status: 400 });
    }

    // ① 먼저 픽업 자국을 걷어냅니다. 남겨두면 체크표는 픽업, 하원수단은 셔틀이 되어 두
    //    화면이 다른 답을 합니다.
    const undo = await undoPickupTraces(supabase, id, { email: me.email, name: me.name ?? null });

    // ② 이번 주 그 요일만 「셔틀」로. 매주 줄(블루웨일버스)은 그대로 두므로 다음 주에는
    //    저절로 원래대로 돌아갑니다 - 사람이 되돌리는 것을 기억할 필요가 없습니다.
    // **저장은 `set_dismissal_plan` 한 곳을 지납니다**(CLAUDE.md §2-9). 조건부 유일 색인
    // 때문에 화면에서 upsert 를 쓸 수 없고, 「지우고 다시 넣기」는 지우기만 성공하면 적혀
    // 있던 하원수단이 조용히 사라집니다.
    const weekStart = weekStartOf(day);
    const note = `오늘만 셔틀 (${(row.channel_label as string | null) ?? (row.source as string | null) ?? "연락"})`;
    const { error: planErr } = await supabase.rpc("set_dismissal_plan", {
      p_student: studentId,
      p_weekday: weekday,
      p_kind: "셔틀",
      p_label: null,
      p_time: null,
      p_note: note,
      p_week_start: weekStart,
      p_by: me.email,
    });
    if (planErr) {
      return NextResponse.json(
        { error: `오늘 하원수단을 셔틀로 바꾸지 못했습니다: ${planErr.message}`, undo },
        { status: 500 },
      );
    }

    // ③ 체크표에도 지금 바로. 사람이 정한 줄로 남겨야 크론이 다시 픽업으로 덮지 않습니다.
    const applied = await applyBoarding(supabase, studentId, day, me.name || me.email, {
      text: ((row.raw_text as string | null) ?? "").trim() || "인박스에서 오늘만 셔틀 탑승으로 확정했습니다.",
      source: (row.source as string | null) ?? "토들",
      from: (row.channel_label as string | null) ?? (row.sender_name as string | null) ?? null,
      url: (row.source_url as string | null) ?? null,
    });

    // ④ 인박스에서 내립니다. 픽업이 아니었다는 정정도 함께 쌓습니다.
    const { error: stErr } = await supabase
      .from("pickup_requests")
      .update({ student_id: studentId, matched_name: name, status: "무시", resolved_by: me.email, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
    await bumpPickupFeedback(supabase, id, false);

    return NextResponse.json({ ok: true, name, seats: applied, undo, undoNote: undoSummary(undo) });
  }

  // ── 학생만 잇기 ───────────────────────────────────────────────────────────
  //
  // 「누구인지 모르는 연락」을 업무보드에서 바로 이을 수 있어야 합니다. 지금까지는 그 줄을
  // 보고 **픽업 인박스로 건너가서** 다시 찾아야 했고, 건너간 김에 다른 일을 하다 잊습니다.
  //
  // **상태는 건드리지 않습니다.** 확인대기는 확인대기로 남습니다 - 학생을 이었다는 것과
  // 「이 연락이 픽업이 맞다」는 다른 판단이고, 문의 줄에는 확정이라는 것이 없습니다.
  if (action === "link") {
    const id = body?.id as string | undefined;
    const studentId = (body?.studentId as string | undefined) ?? null;
    if (!id || !studentId) return NextResponse.json({ error: "어느 연락에 어느 학생인지가 필요합니다." }, { status: 400 });

    const { data: student, error: stuErr } = await supabase
      .from("wr_students")
      .select("name")
      .eq("is_demo", false)
      .eq("id", studentId)
      .maybeSingle();
    if (stuErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${stuErr.message}` }, { status: 500 });
    if (!student) return NextResponse.json({ error: "명부에 없는 학생입니다." }, { status: 400 });

    const { error } = await supabase
      .from("pickup_requests")
      .update({ student_id: studentId, matched_name: (student as { name: string }).name })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, name: (student as { name: string }).name });
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

    /**
     * **한 글에 부탁이 여럿일 수 있습니다.**
     *
     * 「점심 뒤 약, 그리고 잃어버린 후디 찾기」는 할 일이 둘입니다. 한 건으로 받으면 종류가
     * 하나로 정해지고 나머지는 딸린 말이 되어 아무도 안 찾습니다.
     *
     * 예전 모양(kind/content/atTime 한 벌)도 그대로 받습니다 - 열려 있는 화면이 바로
     * 실패하지 않게 합니다.
     */
    const rawNotes = Array.isArray(body?.notes)
      ? (body.notes as { kind?: unknown; content?: unknown; atTime?: unknown }[])
      : [{ kind: body?.kind, content: body?.content, atTime: body?.atTime }];

    const notes = rawNotes.map((n) => ({
      kind: isNoteKind(n?.kind) ? n.kind : ("기타" as const),
      content: String((n?.content as string | undefined) ?? "").trim(),
      atTime: String((n?.atTime as string | undefined) ?? "").trim(),
    }));

    if (notes.length === 0 || notes.every((n) => !n.content))
      return NextResponse.json({ error: "무엇을 해야 하는지 적어주세요." }, { status: 400 });
    if (notes.some((n) => n.content.length > 300))
      return NextResponse.json({ error: "내용은 한 건에 300자까지입니다." }, { status: 400 });
    // 못 읽는 시각이 들어가면 알람이 그 줄만 조용히 건너뜁니다. 사람은 적어뒀다고 믿습니다.
    if (notes.some((n) => n.atTime && !isClockTime(n.atTime)))
      return NextResponse.json({ error: "시각은 14:30 처럼 적어주세요." }, { status: 400 });

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

    // **전부 들어가거나 아무것도 안 들어갑니다.** 한 번에 넣어야 둘 중 하나만 남는 상태가
    // 생기지 않습니다 - 절반만 들어간 것을 「완료」로 보여주면 빠진 쪽은 아무도 안 찾습니다.
    const { data: inserted, error: noteErr } = await supabase
      .from("student_day_notes")
      .insert(
        notes
          .filter((n) => n.content)
          .map((n) => ({
            student_id: studentId,
            student_name: (student as { name: string }).name,
            on_date: onDate,
            at_time: n.atTime || null,
            kind: n.kind,
            content: n.content,
            source_inquiry_id: id,
            created_by: me.email,
            created_by_name: me.name || me.email,
          })),
      )
      .select("id");

    if (noteErr || !inserted?.length) {
      // **못 적었으면 인박스에서도 내리지 않습니다.** 내려간 채로 실패하면 그 부탁은 어디에도
      // 안 남고, 화면에는 처리된 것처럼 보입니다.
      await supabase.from("pickup_requests").update({ status: before, resolved_by: null, resolved_at: null }).eq("id", id);
      return NextResponse.json(
        { error: `특이사항을 저장하지 못했습니다: ${noteErr?.message ?? "저장된 줄이 없습니다"}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      noteIds: (inserted as { id: string }[]).map((n) => n.id),
      noteCount: inserted.length,
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
