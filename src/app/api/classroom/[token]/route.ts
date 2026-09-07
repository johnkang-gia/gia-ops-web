import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { APP_VERSION } from "@/lib/version";
import { kstParts } from "@/lib/shuttleTracking";

export const dynamic = "force-dynamic";

// 교실 태블릿이 부르는 유일한 주소입니다.
//
// 로그인이 없습니다. 반마다 다른 기기·다른 와이파이라 로그인 관리가 곧 부담이 되고,
// 풀린 태블릿은 조용히 아무 일도 안 합니다. 안내보드·도착체크와 같이 토큰 하나로 엽니다.
// 그 대신 **표를 직접 열어주지 않습니다** - 서버가 service role 로 읽어 필요한 것만 보냅니다.

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = admin();
  if (!db) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const { data: link } = await db
    .from("classroom_links")
    .select("id, class_id, label, enabled, dismissal_auto")
    .or(`token.eq.${token},short_code.eq.${token}`)
    .maybeSingle();
  if (!link || !link.enabled) {
    return NextResponse.json({ error: "유효하지 않거나 꺼진 링크입니다." }, { status: 403 });
  }

  // 이 화면이 살아 있다는 표시. 호출을 보냈는데 아무도 못 보는 상태를 알아채는 단서입니다.
  await db.from("classroom_links").update({ last_seen_at: new Date().toISOString() }).eq("id", link.id);

  const { data: cls } = await db
    .from("wr_classes")
    .select("id, grade, class_name, teacher_name, room, is_demo")
    .eq("id", link.class_id)
    .maybeSingle();
  if (!cls || cls.is_demo) {
    return NextResponse.json({ error: "반을 찾지 못했습니다." }, { status: 404 });
  }

  const now = new Date();
  const { iso: today, weekday, hour } = kstParts(now);
  const minute = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCMinutes();
  const nowMinutes = hour * 60 + minute;

  // 아직 확인하지 않은 호출. 취소된 것은 빼고, 오늘 것만 봅니다 - 어제 못 본 호출이 오늘
  // 아침에 울리면 그건 알림이 아니라 놀람입니다.
  const { data: calls } = await db
    .from("classroom_calls")
    .select("id, kind, student_name, reason, created_at, created_by")
    .eq("class_id", cls.id)
    .is("acked_at", null)
    .is("canceled_at", null)
    .gte("created_at", `${today}T00:00:00+09:00`)
    .order("created_at", { ascending: true })
    .limit(10);

  // 반 학생 명단(출결 확정용). 태블릿은 교실에 놓여 아이들이 지나다니므로 **이름만** 보냅니다 -
  // 보호자 연락처·생년월일·형제자매는 이 화면에 있을 이유가 없습니다.
  const { data: roster } = await db
    .from("wr_students")
    .select("id, name")
    .eq("status", "active")
    .eq("is_demo", false)
    .eq("grade", cls.grade)
    .eq("class_name", cls.class_name)
    .order("name");

  // 오늘 이미 찍힌 출결.
  const ids = (roster ?? []).map((s) => s.id as string);
  const { data: marks } = ids.length
    ? await db.from("attendance_records").select("student_id, status").eq("date", today).in("student_id", ids)
    : { data: [] as { student_id: string; status: string }[] };
  const markByStudent = Object.fromEntries(
    ((marks as { student_id: string; status: string }[] | null) ?? []).map((m) => [m.student_id, m.status])
  );

  // 지금 교시(있으면).
  const { data: periods } = await db
    .from("wr_periods")
    .select("id, label, start_time, end_time")
    .order("start_time");
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const cur =
    (periods ?? []).find(
      (p) => nowMinutes >= toMin((p.start_time as string).slice(0, 5)) && nowMinutes < toMin((p.end_time as string).slice(0, 5))
    ) ?? null;

  return NextResponse.json({
    appVersion: APP_VERSION,
    today,
    isWeekday: weekday >= 1 && weekday <= 5,
    className: `${cls.grade ?? ""} ${cls.class_name ?? ""}`.trim(),
    teacher: (cls.teacher_name as string | null) ?? null,
    room: (cls.room as string | null) ?? null,
    periodLabel: cur ? ((cur.label as string | null) ?? null) : null,
    dismissalAuto: !!link.dismissal_auto,
    calls: (calls ?? []).map((c) => ({
      id: c.id as string,
      kind: c.kind as string,
      studentName: (c.student_name as string | null) ?? null,
      reason: (c.reason as string | null) ?? null,
      at: c.created_at as string,
      by: (c.created_by as string | null) ?? null,
    })),
    roster: (roster ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      status: markByStudent[s.id as string] ?? null,
    })),
  });
}

// 교실에서 [확인]을 누름. 이게 차야 «받았다»가 됩니다.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = admin();
  if (!db) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const { data: link } = await db
    .from("classroom_links")
    .select("id, class_id, enabled")
    .or(`token.eq.${token},short_code.eq.${token}`)
    .maybeSingle();
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    ackCallId?: string;
    attendance?: { studentId: string; status: string }[];
  };

  if (body.ackCallId) {
    // 남의 반 호출을 확인해버리지 않도록 반까지 함께 봅니다.
    const { error } = await db
      .from("classroom_calls")
      .update({ acked_at: new Date().toISOString(), acked_by: "교실" })
      .eq("id", body.ackCallId)
      .eq("class_id", link.class_id)
      .is("acked_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.attendance) {
    const today = kstParts(new Date()).iso;
    // 출석은 굳이 줄을 만들지 않습니다. 결석·지각·조퇴만 남기고, 되돌리면 그 줄을 지웁니다 -
    // 137명 곱하기 수업일수만큼 «출석» 줄을 쌓아두면 표만 무거워지고 읽을 것은 없습니다.
    const drop = body.attendance.filter((a) => !a.status || a.status === "출석").map((a) => a.studentId);
    const keep = body.attendance.filter((a) => a.status && a.status !== "출석");
    if (drop.length) {
      const { error } = await db.from("attendance_records").delete().eq("date", today).in("student_id", drop);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (keep.length) {
      const { error } = await db.from("attendance_records").upsert(
        keep.map((a) => ({
          date: today,
          student_id: a.studentId,
          status: a.status,
          source: "교실",
          checked_at: new Date().toISOString(),
          // 자동으로 들어온 줄이 아니라 사람이 교실에서 직접 찍은 것입니다.
          confirmed_by_human: true,
        })),
        { onConflict: "student_id,date" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "할 일이 없습니다." }, { status: 400 });
}
