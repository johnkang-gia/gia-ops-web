import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// 한 반의 일주일 시간표.
//
// 요청: "각반을 누르면 일주일 시간표가 팝업창으로 뜨도록"
//
// 대시보드는 로그인 없는 토큰 링크라, 토큰이 살아 있는지 먼저 확인하고 그 반의 월~금
// 시간표를 통째로 내려줍니다.

export const dynamic = "force-dynamic";

const WEEKDAYS = [1, 2, 3, 4, 5]; // 월~금

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const classId = new URL(req.url).searchParams.get("classId");
  if (!classId) return NextResponse.json({ error: "classId가 필요합니다." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link } = await supabase.from("ops_board_links").select("enabled").eq("token", token).maybeSingle();
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 403 });

  // 반 정보(부서·학년·반이름)로 교시 목록을 찾습니다. 교시는 부서마다 시간이 다릅니다.
  const { data: cls } = await supabase
    .from("wr_classes")
    .select("id, grade, class_name, department")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "반을 찾을 수 없습니다." }, { status: 404 });

  const { data: periods } = await supabase
    .from("wr_periods")
    .select("id, period_no, label, start_time, end_time")
    .eq("department", cls.department)
    .order("start_time");

  const periodList = (periods ?? []).map((p) => ({
    id: p.id as string,
    label: (p.label as string | null) ?? `${p.period_no}교시`,
    startTime: (p.start_time as string).slice(0, 5),
    endTime: (p.end_time as string).slice(0, 5),
  }));

  const { data: rows } = await supabase
    .from("wr_timetable")
    .select("period_id, weekday, subject_name, teacher_name, room")
    .eq("class_id", classId)
    .in("weekday", WEEKDAYS);

  // period_id + weekday 로 빠르게 찾도록 정리합니다.
  const byKey = new Map<string, { subject: string; teacher: string | null; room: string | null }>();
  for (const r of rows ?? []) {
    byKey.set(`${r.period_id}-${r.weekday}`, {
      subject: (r.subject_name as string) ?? "",
      teacher: (r.teacher_name as string | null) ?? null,
      room: (r.room as string | null) ?? null,
    });
  }

  // 교시(행) × 요일(열) 표. 화면에서 그대로 그릴 수 있게 미리 채워 보냅니다.
  const grid = periodList.map((p) => ({
    period: p,
    days: WEEKDAYS.map((wd) => byKey.get(`${p.id}-${wd}`) ?? null),
  }));

  return NextResponse.json({
    className: `${cls.grade ?? ""} ${cls.class_name ?? ""}`.trim(),
    weekdays: ["월", "화", "수", "목", "금"],
    grid,
  });
}
