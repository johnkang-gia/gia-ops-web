import { NextResponse } from "next/server";
import { todayKst } from "@/lib/kst";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const STATUS_VALUES = ["예정", "탑승", "미탑승", "결석", "픽업"];

// 체크인 페이지의 "탑승/하차/결석" 버튼이 부르는 곳입니다(2단계-a). shuttle_boardings에 이미
// 만들어져 있던 하루치 탑승 체크 테이블을 처음으로 화면과 연결합니다. assignmentId가 이 토큰의
// 노선에 실제로 속하는지 서버에서 확인해, 다른 노선 학생을 잘못/악의적으로 건드리지 못하게 막습니다.
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const token = body?.token as string | undefined;
  const assignmentId = body?.assignmentId as string | undefined;
  const field = body?.field as string | undefined;
  const value = body?.value;
  if (!token || !assignmentId || (field !== "status" && field !== "alighted")) {
    return NextResponse.json({ error: "token, assignmentId, field(status|alighted)가 필요합니다." }, { status: 400 });
  }
  if (field === "status" && !STATUS_VALUES.includes(value)) {
    return NextResponse.json({ error: "status 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (field === "alighted" && typeof value !== "boolean") {
    return NextResponse.json({ error: "alighted 값은 true/false여야 합니다." }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: pilot, error: pilotError } = await supabase
    .from("shuttle_pilot_routes")
    .select("route_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (pilotError) return NextResponse.json({ error: pilotError.message }, { status: 500 });
  if (!pilot || !pilot.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  // 이 배정이 정말 이 토큰의 노선에 속하는지 확인합니다.
  const { data: assignment } = await supabase.from("shuttle_assignments").select("stop_id").eq("id", assignmentId).maybeSingle();
  if (!assignment) return NextResponse.json({ error: "배정을 찾을 수 없습니다." }, { status: 404 });
  const { data: stop } = await supabase.from("shuttle_stops").select("route_id").eq("id", assignment.stop_id).maybeSingle();
  if (!stop || stop.route_id !== pilot.route_id) {
    return NextResponse.json({ error: "이 노선에 속하지 않는 학생입니다." }, { status: 403 });
  }

  const today = todayKst();
  const checkedBy = "체크인(" + token.slice(0, 8) + ")";
  const patch: Record<string, unknown> =
    field === "status"
      ? { status: value, checked_by: checkedBy, checked_at: new Date().toISOString() }
      : { alighted_at: value ? new Date().toISOString() : null };

  const { error: upsertError } = await supabase
    .from("shuttle_boardings")
    .upsert({ service_date: today, assignment_id: assignmentId, ...patch }, { onConflict: "service_date,assignment_id" });
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
