import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyPickup } from "@/lib/pickupIngest";
import { kstParts } from "@/lib/shuttleTracking";
import { genCaseId } from "@/lib/caseId";
import { touchHeartbeat } from "@/lib/heartbeat";

// 오늘 예정된 픽업을 실제로 걸어줍니다.
//
// 학부모가 "이번주 목금 픽업입니다"라고 보내면 그 자리에서 목요일·금요일 두 줄이 예약됩니다.
// 이 크론이 매일 아침 그날치를 꺼내 하원 체크표에 픽업으로 표시하고, 담임 선생님께 알립니다.
//
// 사람이 기억하고 있다가 그날 손으로 거는 방식은 반드시 언젠가 빠집니다. 특히 아이를 차에
// 태워 보내는 일은 한 번 빠지면 되돌릴 수 없습니다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { iso: today, weekday } = kstParts(new Date());

  // 주말에는 하원 차량이 없습니다.
  if (weekday === 0 || weekday === 6) {
    return NextResponse.json({ ok: true, skipped: "주말" });
  }

  const { data: rows, error } = await supabase
    .from("pickup_schedules")
    .select(
      "id, request_id, student_id, student_name, service_date, pickup_time, needs_confirm, homeroom_email, task_id, source_note"
    )
    .eq("service_date", today)
    .eq("status", "예정");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  let applied = 0;
  let failed = 0;
  let notified = 0;

  for (const row of rows) {
    const studentId = row.student_id as string | null;

    // 학생을 명부에서 못 찾은 예약은 자동으로 걸 수 없습니다. 조용히 넘기지 않고 '실패'로
    // 남겨 인박스에 드러나게 합니다.
    if (!studentId) {
      await supabase
        .from("pickup_schedules")
        .update({ status: "실패", source_note: "학생을 명부에서 찾지 못했습니다." })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    const seats = await applyPickup(supabase, studentId, today);

    // 차량을 타지 않는 학생이면 좌석이 없습니다. 이건 오류가 아니라 원래 걸 것이 없는 경우라
    // '적용됨'으로 두되 기록은 남깁니다.
    await supabase
      .from("pickup_schedules")
      .update({
        status: "적용됨",
        applied_at: new Date().toISOString(),
        source_note: seats === 0 ? "차량 배정이 없는 학생입니다(픽업 표시할 좌석 없음)." : row.source_note ?? null,
      })
      .eq("id", row.id);
    applied += 1;

    // ── 담임 선생님께 알립니다 ──────────────────────────────────────────────
    const homeroom = row.homeroom_email as string | null;
    if (homeroom && !row.task_id) {
      const name = (row.student_name as string | null) ?? "학생";
      const time = (row.pickup_time as string | null) ?? null;
      const confirmMark = row.needs_confirm ? " · 확인 필요" : "";
      const { data: task } = await supabase
        .from("tasks")
        .insert({
          case_id: genCaseId("TSK"),
          title: `[오늘 픽업] ${name}${time ? ` ${time}` : ""}${confirmMark}`,
          status: "예정",
          priority: "긴급",
          owner_email: homeroom,
          assignee_emails: [homeroom],
          position: Date.now(),
          due_date: today,
          description: [
            `${name} 학생이 오늘 픽업 예정입니다${time ? ` (${time})` : ""}.`,
            row.needs_confirm
              ? "학부모 표현이 분명하지 않아 자동으로 잡은 날짜입니다. 맞는지 한 번 확인해주세요."
              : null,
            "하원 체크표에는 이미 픽업으로 표시되어 있습니다.",
          ]
            .filter(Boolean)
            .join("\n"),
        })
        .select("id")
        .single();

      if (task?.id) {
        await supabase.from("pickup_schedules").update({ task_id: task.id }).eq("id", row.id);
        notified += 1;
      }
    }
  }

  // ── 기간으로 잡힌 특이사항 ────────────────────────────────────────────────
  //
  // 담당자: "'~까지 픽업' 또는 '언제까지 결석'이라는 문구가 나오면 그건 특이사항에 올려서
  //          그 기간 동안 반영되게 만들어야 해."
  //
  // 예약(pickup_schedules)은 날짜마다 한 줄이라 하루짜리에 맞습니다. 며칠 이어지는 상태는
  // 특이사항 한 줄로 두고 매일 아침 "오늘이 그 기간 안인가"만 봅니다. 그래야 중간에 한 줄이
  // 빠져 조용히 넘어가는 일이 없고, 하원체크표 옆 위젯에서 "언제까지인지"가 보입니다.
  let periodApplied = 0;
  const { data: notes } = await supabase
    .from("shuttle_persistent_notes")
    .select("id, student_id, student_name, effect_kind, effect_from, effect_to")
    .eq("active", true)
    .in("effect_kind", ["pickup", "absent"])
    .lte("effect_from", today)
    .gte("effect_to", today);

  for (const n of (notes as { id: string; student_id: string | null; student_name: string; effect_kind: string }[] | null) ?? []) {
    if (!n.student_id) continue; // 학생이 안 붙은 것은 사람이 봐야 합니다.
    if (n.effect_kind === "pickup") {
      periodApplied += (await applyPickup(supabase, n.student_id, today)) > 0 ? 1 : 0;
      continue;
    }
    // 결석: 그날 그 아이의 배정을 결석으로 표시합니다.
    const { data: asg } = await supabase.from("shuttle_assignments").select("id").eq("student_id", n.student_id);
    for (const a of (asg as { id: string }[] | null) ?? []) {
      await supabase
        .from("shuttle_boardings")
        .upsert(
          { service_date: today, assignment_id: a.id, status: "결석", updated_by: "AI(기간 특이사항)" },
          { onConflict: "service_date,assignment_id" }
        );
    }
    if ((asg ?? []).length > 0) periodApplied += 1;
  }

  await touchHeartbeat(supabase, "cron:pickup-schedules");
  return NextResponse.json({ ok: true, date: today, applied, failed, notified, periodApplied });
}
