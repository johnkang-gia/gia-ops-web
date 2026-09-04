import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { kstParts } from "@/lib/shuttleTracking";
import { buildPickupTask } from "@/lib/pickupTask";

export const dynamic = "force-dynamic";

/**
 * 오늘 확정된 픽업을 업무보드에 올립니다.
 *
 * 수집기가 새로 받는 건은 그 자리에서 업무가 생기지만, **이미 들어와 있던 건**과 사람이
 * 인박스에서 손으로 확정한 건은 그 길을 안 지납니다. 그래서 픽업 인박스를 열 때 한 번
 * 훑어 빠진 것을 채웁니다.
 *
 * 두 번 만들지 않는 장치는 `pickup_requests.task_id` 하나입니다 - 채워져 있으면 건너뜁니다.
 */
export async function POST() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = await createClient();
  const today = kstParts(new Date()).iso;

  const { data: rows, error } = await supabase
    .from("pickup_requests")
    .select(
      "id, kind, status, service_date, student_id, matched_name, ai_student_name, ai_pickup_time, raw_text, summary, source, source_url, task_id, is_demo",
    )
    .eq("service_date", today)
    .eq("status", "확정")
    .is("task_id", null)
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targets = (rows ?? []).filter(
    (r) => !r.is_demo && (r.kind === "픽업" || r.kind === null),
  );
  if (targets.length === 0) return NextResponse.json({ ok: true, created: 0 });

  // 학생의 부서·반, 그리고 반의 교실을 한 번에 읽습니다. 줄마다 조회하면 픽업이 많은 날
  // 화면이 그만큼 늦게 뜹니다.
  const ids = targets.map((r) => r.student_id).filter((v): v is string => !!v);
  const { data: students } = ids.length
    ? await supabase
        .from("wr_students")
        .select("id, name, grade, class_name, class_id, department")
        .eq("is_demo", false)
        .in("id", ids)
    : { data: [] };
  const { data: classes } = await supabase
    .from("wr_classes")
    .select("id, grade, class_name, room")
    .eq("is_demo", false);

  type S = { id: string; name: string; grade: string | null; class_name: string | null; class_id: string | null; department: string | null };
  type C = { id: string; grade: string | null; class_name: string | null; room: string | null };
  const byId = new Map(((students as S[] | null) ?? []).map((s) => [s.id, s]));
  const clsById = new Map(((classes as C[] | null) ?? []).map((c) => [c.id, c]));

  let created = 0;
  for (const r of targets) {
    const s = r.student_id ? byId.get(r.student_id) : undefined;
    const cls = s?.class_id ? clsById.get(s.class_id) : undefined;
    const place =
      [s?.grade ? `${s.grade}학년` : null, s?.class_name ?? null, cls?.room ?? null].filter(Boolean).join(" ") || null;

    const payload = buildPickupTask({
      studentName: s?.name ?? ((r.matched_name as string | null) ?? (r.ai_student_name as string | null) ?? "학생 미확인"),
      pickupTime: (r.ai_pickup_time as string | null) ?? null,
      serviceDate: today,
      place,
      department: s?.department ?? null,
      // 픽업은 행정실이 나가는 일입니다. 담임을 담당자로 걸면 교실을 비울 수 없는 사람에게
      // 일이 붙습니다. 지금 화면을 연 행정직원이 맡되, 화면에서 바꿀 수 있습니다.
      ownerEmail: me.email,
      assigneeEmails: [me.email],
      rawText: ((r.raw_text as string | null) ?? (r.summary as string | null)) ?? null,
      sourceLabel: (r.source as string | null) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
    });

    const { data: task, error: taskErr } = await supabase.from("tasks").insert(payload).select("id").single();
    // 한 건이 실패해도 나머지는 계속 만듭니다. 다만 조용히 넘기지 않고 소리는 냅니다 -
    // 픽업 업무가 통째로 안 생기는 것이 가장 나쁩니다.
    if (taskErr || !task) {
      console.error("[픽업→업무] 만들지 못했습니다:", taskErr?.message);
      continue;
    }
    await supabase.from("pickup_requests").update({ task_id: task.id }).eq("id", r.id);
    created += 1;
  }

  return NextResponse.json({ ok: true, created });
}
