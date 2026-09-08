import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { loadTodayPickups } from "@/lib/pickups";
import { kstParts } from "@/lib/shuttleTracking";

/**
 * 오늘 「시각이 정해진 하원」과 그 아이가 지금 있는 자리.
 *
 * 사무실 대형 모니터(운영 대시보드)에만 있던 5분 전 알람을, 사람이 실제로 앉아서 보는
 * 업무보드에도 띄우기 위한 창구입니다. 대형 모니터는 아무도 안 볼 때가 있고, 그때
 * 놓치면 아이가 문 앞에서 기다립니다.
 *
 * **판단은 두 곳에서 하지 않습니다.** 픽업은 loadTodayPickups 한 곳에서 모으고, 시각이
 * 없으면 평소 하원수단(요일별)의 출발 시각을 물려받습니다 - 운영 대시보드와 같은 규칙입니다.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const now = new Date();
  const { iso: today, weekday, hour } = kstParts(now);
  const minute = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCMinutes();
  const nowMinutes = hour * 60 + minute;

  const { data: students } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name")
    .eq("status", "active")
    .eq("is_demo", false);
  const byId = new Map((students ?? []).map((s) => [s.id as string, s]));
  const byName = new Map((students ?? []).map((s) => [(s.name as string) ?? "", s]));

  const pickups = await loadTodayPickups(supabase, today, (id: string) => (byId.get(id)?.name as string) ?? null);

  // 오늘 요일의 하원수단(셔틀 제외). 시각이 적혀 있는 것만 알람 대상입니다.
  const { data: plans } =
    weekday >= 1 && weekday <= 5
      ? await supabase
          .from("student_dismissal_plans")
          .select("student_id, kind, label, depart_time")
          .eq("weekday", weekday)
          .neq("kind", "셔틀")
      : { data: [] as { student_id: string; kind: string; label: string | null; depart_time: string | null }[] };
  const planByStudent = new Map((plans ?? []).map((p) => [p.student_id as string, p]));

  // ── 지금 어느 교실에서 무슨 수업 중인가 ────────────────────────────────────
  const [{ data: periods }, { data: classes }] = await Promise.all([
    supabase.from("wr_periods").select("id, start_time, end_time").order("start_time"),
    supabase.from("wr_classes").select("id, grade, class_name, room").eq("is_demo", false),
  ]);
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const current = (periods ?? []).find(
    (p) => nowMinutes >= toMin(p.start_time as string) && nowMinutes < toMin(p.end_time as string)
  );
  const classByKey = new Map((classes ?? []).map((c) => [`${c.grade ?? ""}|${c.class_name ?? ""}`, c]));
  const { data: lessons } =
    current && weekday >= 1 && weekday <= 5
      ? await supabase
          .from("wr_timetable")
          .select("class_id, subject_name, room")
          .eq("weekday", weekday)
          .eq("period_id", current.id)
      : { data: [] as { class_id: string; subject_name: string; room: string | null }[] };
  const lessonByClass = new Map((lessons ?? []).map((l) => [l.class_id as string, l]));

  type Alarm = { key: string; name: string; time: string; className: string | null; where: string; via: string | null };
  const out: Alarm[] = [];
  const seen = new Set<string>();

  function place(grade: string | null, className: string | null): string {
    const cls = classByKey.get(`${grade ?? ""}|${className ?? ""}`);
    if (!cls) return "교실 미확인";
    const l = lessonByClass.get(cls.id as string);
    if (l) return `${l.subject_name}${l.room ? ` · ${l.room}` : cls.room ? ` · ${cls.room}` : ""}`;
    return cls.room ? `교실 ${cls.room}` : "지금 수업 없음";
  }

  for (const p of pickups) {
    const st = (p.studentId ? byId.get(p.studentId) : byName.get(p.name)) ?? null;
    const plan = st ? planByStudent.get(st.id as string) : undefined;
    // 학부모 연락에 시각이 없으면 평소 하원수단의 출발 시각을 씁니다. 시각을 모르면
    // 알릴 때도 모릅니다 - 그런 건은 알람 목록에서 빠지고 화면 목록에만 남습니다.
    const time = p.time ?? (((plan?.depart_time as string | null) ?? "").slice(0, 5) || null);
    if (!time) continue;
    const key = `${p.name}|${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name: p.name,
      time,
      className: (st?.class_name as string | null) ?? null,
      where: place((st?.grade as string | null) ?? null, (st?.class_name as string | null) ?? null),
      via: plan ? [plan.kind as string, (plan.label as string | null) ?? null].filter(Boolean).join(" · ") : null,
    });
  }

  // 픽업 연락이 없어도 시각이 적힌 하원수단은 알립니다(매주 오는 학원차).
  for (const [sid, plan] of planByStudent) {
    const time = ((plan.depart_time as string | null) ?? "").slice(0, 5);
    if (!time) continue;
    const st = byId.get(sid);
    if (!st) continue;
    const key = `${st.name}|${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name: st.name as string,
      time,
      className: (st.class_name as string | null) ?? null,
      where: place((st.grade as string | null) ?? null, (st.class_name as string | null) ?? null),
      via: [plan.kind as string, (plan.label as string | null) ?? null].filter(Boolean).join(" · "),
    });
  }

  out.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name, "ko"));
  return NextResponse.json({ ok: true, nowMinutes, alarms: out });
}
