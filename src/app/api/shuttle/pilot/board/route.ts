import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToSubscription } from "@/lib/webPush";

export const dynamic = "force-dynamic";

const STATUS_VALUES = ["예정", "탑승", "미탑승", "결석", "픽업"];
// 이 상태로 바뀔 때만 알림을 보냅니다("예정"으로 되돌리는 취소 탭은 알림을 보내지 않습니다).
const NOTIFY_STATUS_VALUES = new Set(["탑승", "미탑승", "결석"]);

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
  const { data: assignment } = await supabase
    .from("shuttle_assignments")
    .select("stop_id, student_id, student_name_raw")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return NextResponse.json({ error: "배정을 찾을 수 없습니다." }, { status: 404 });
  const { data: stop } = await supabase.from("shuttle_stops").select("route_id").eq("id", assignment.stop_id).maybeSingle();
  if (!stop || stop.route_id !== pilot.route_id) {
    return NextResponse.json({ error: "이 노선에 속하지 않는 학생입니다." }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const checkedBy = "체크인(" + token.slice(0, 8) + ")";
  const patch: Record<string, unknown> =
    field === "status"
      ? { status: value, checked_by: checkedBy, checked_at: new Date().toISOString() }
      : { alighted_at: value ? new Date().toISOString() : null };

  const { error: upsertError } = await supabase
    .from("shuttle_boardings")
    .upsert({ service_date: today, assignment_id: assignmentId, ...patch }, { onConflict: "service_date,assignment_id" });
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  // 학부모 테스트 알림(2단계-c) - 탑승/미탑승/결석으로 확정되거나 하차가 확인되면 그 학생을
  // 구독 중인 기기로 푸시를 보냅니다. 실패해도 체크인 자체는 이미 저장됐으니 응답은 그대로 성공.
  const shouldNotify = (field === "status" && NOTIFY_STATUS_VALUES.has(value)) || (field === "alighted" && value === true);
  if (shouldNotify && assignment.student_id) {
    const { data: subs } = await supabase
      .from("shuttle_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("student_id", assignment.student_id);
    if (subs && subs.length > 0) {
      const name = assignment.student_name_raw || "학생";
      const body = field === "alighted" ? `${name} 학생 하차가 확인되었습니다.` : `${name} 학생 ${value} 확인되었습니다.`;
      const results = await Promise.all(
        subs.map((s) => sendPushToSubscription({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: "GIA 셔틀", body }))
      );
      const expiredIds = subs.filter((_, i) => results[i].expired).map((s) => s.id);
      if (expiredIds.length > 0) {
        await supabase.from("shuttle_push_subscriptions").delete().in("id", expiredIds);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
