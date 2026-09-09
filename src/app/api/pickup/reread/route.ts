import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { judgePickupText, loadRoster } from "@/lib/pickupIngest";
import { matchStudent, normalizeTime, parseChannelLabel } from "@/lib/pickupParse";
import { kstParts } from "@/lib/shuttleTracking";
import { logApiError } from "@/lib/logging";

/**
 * **AI가 못 읽은 연락을 다시 읽습니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * AI 호출이 실패하면 연락을 버리지 않고 「문의 · 확인대기」로 남깁니다. 그건 맞는 처리인데,
 * **다시 읽을 길이 없었습니다.** 잠깐 끊긴 것이면 한 건이지만, 결제가 막힌 것처럼 며칠
 * 이어지면 그동안 들어온 연락이 **전부** 안 읽힌 채로 인박스에 쌓입니다.
 *
 * 그 줄들은 「누가 언제 무슨 부탁을 했는지」가 요약도 없이 원문만 있는 상태라, 사람이 하나씩
 * 열어 읽어야 합니다. 바쁜 하원 시간에 그걸 다 읽는 사람은 없고, 안 읽은 것은 없는 것과
 * 같습니다.
 *
 * ── 이 창구가 하는 일 ────────────────────────────────────────────────
 *
 * 못 읽은 줄의 원문을 **처음과 똑같은 판단**(`judgePickupText`)에 다시 태워서, 종류·시각·
 * 학생·요약을 채웁니다.
 *
 * **셔틀에는 자동으로 반영하지 않습니다.** 며칠 전 「오늘 3시 픽업」을 오늘 자동으로 걸면
 * 엉뚱한 날 아이가 명단에서 빠집니다. 채워 넣기만 하고, 거는 것은 인박스에서 사람이 합니다 -
 * 지난 일을 자동이 되살리는 것보다 사람이 한 번 보는 편이 안전합니다.
 */

export const dynamic = "force-dynamic";
/** 한 번에 다시 읽을 최대 건수. 너무 많으면 응답이 늦고 AI 비용도 한꺼번에 나갑니다. */
const MAX = 40;

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const body = (await req.json().catch(() => ({}))) as { id?: string; days?: number };
  const days = Math.min(Math.max(body.days ?? 14, 1), 60);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // 못 읽은 줄만 고릅니다. 판단이 잘 된 줄까지 다시 읽으면 사람이 고쳐놓은 것을 덮습니다.
  const base = supabase.from("pickup_requests").select("id, raw_text, channel_label, received_at, ai_note");
  const { data: rows, error } = body.id
    ? await base.eq("id", body.id).limit(1)
    : await base
        .not("raw_text", "is", null)
        .like("ai_note", "AI 판단에 실패%")
        .gte("received_at", since)
        .order("received_at", { ascending: false })
        .limit(MAX);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, found: 0, reread: 0, stillFailed: 0 });

  const roster = await loadRoster(supabase);
  let reread = 0;
  let stillFailed = 0;
  const failures: string[] = [];

  for (const r of rows) {
    const text = ((r.raw_text as string | null) ?? "").trim();
    if (!text) continue;

    // **그때의 오늘**로 읽습니다. 지금 날짜로 읽으면 「내일 픽업」이 엉뚱한 날이 됩니다 -
    // 사흘 전 연락의 「내일」은 이틀 전이지 내일이 아닙니다.
    const receivedAt = r.received_at ? new Date(r.received_at as string) : new Date();
    const { iso: thenKst, weekday: thenWeekday } = kstParts(receivedAt);
    const channel = parseChannelLabel(r.channel_label as string | null);
    const channelHint = channel
      ? `\n\n[채널 정보] 이 연락은 "${channel.names.join(", ")}" 학생(${channel.grades.join(", ")}) 가정의 대화방에서 왔습니다.`
      : "";

    const judged = await judgePickupText(text, { channelHint, todayKst: thenKst, todayWeekday: thenWeekday });
    if (judged.failed) {
      // 또 실패했으면 줄을 건드리지 않습니다. 원인이 아직 남아 있다는 뜻이고, 이유를 모아
      // 사람에게 그대로 돌려줍니다 - 「0건 처리됨」만 뜨면 왜 안 됐는지 알 수 없습니다.
      stillFailed += 1;
      if (judged.reason && !failures.includes(judged.reason)) failures.push(judged.reason);
      continue;
    }

    const ai = judged.ai as {
      kind?: unknown;
      student_name?: unknown;
      pickup_time?: unknown;
      summary?: unknown;
      note?: unknown;
      confidence?: unknown;
    };
    const kind = typeof ai.kind === "string" && ["픽업", "문의", "기타"].includes(ai.kind) ? ai.kind : "문의";
    const isPickup = kind === "픽업";
    const candidate =
      (channel && !channel.isSibling ? channel.names[0] : null) ??
      (typeof ai.student_name === "string" ? ai.student_name : null);
    // 동명이인을 가르는 재료(반·생일)는 원문에 있습니다. 이름 글자만 넘기면 김재이 셋을
    // 가릴 수 없습니다 - 문장 전체를 함께 넘깁니다.
    const matched = candidate ? matchStudent(candidate, roster, channel?.grades[0] ?? null, text) : null;

    const { error: upErr } = await supabase
      .from("pickup_requests")
      .update({
        kind,
        ai_is_pickup: isPickup,
        ai_student_name: candidate,
        ai_pickup_time: isPickup ? normalizeTime(ai.pickup_time) : null,
        ai_confidence: typeof ai.confidence === "number" ? Math.max(0, Math.min(1, ai.confidence)) : 0,
        summary: typeof ai.summary === "string" ? ai.summary.slice(0, 200) : null,
        // 다시 읽었다는 사실을 남깁니다. 처음 판단과 다를 수 있으니 사람이 알아야 합니다.
        ai_note: [
          `다시 읽음 (${me.name ?? me.email})`,
          typeof ai.note === "string" ? ai.note : null,
          "셔틀에는 아직 반영되지 않았습니다 - 맞으면 눌러서 등록해주세요.",
        ]
          .filter(Boolean)
          .join(" / ")
          .slice(0, 300),
        student_id: matched?.id ?? null,
        matched_name: matched?.name ?? null,
      })
      .eq("id", r.id as string);
    if (upErr) {
      await logApiError(supabase, "pickup:reread", upErr);
      stillFailed += 1;
      continue;
    }
    reread += 1;
  }

  return NextResponse.json({
    ok: true,
    found: rows.length,
    reread,
    stillFailed,
    // 아직도 실패하면 원인이 안 고쳐진 것입니다. 그 이유를 그대로 올려보냅니다.
    failures,
  });
}
