import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { todayKst } from "@/lib/kst";

// 오늘만 같이 타는 아이.
//
// 자동으로 읽어 넣은 것을 사람이 **고르고 · 확정하고 · 취소**하는 자리입니다. 자동이 늘
// 맞을 수는 없습니다. 특히 '하임이' 처럼 짧게 부른 이름은 명부에 둘 이상 걸립니다.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string | undefined;
  const supabase = await createClient();
  const who = me.name || me.email;

  // ── 새로 만들기 (사람이 직접) ────────────────────────────────────────────
  if (action === "create") {
    const studentId = body?.studentId as string | undefined;
    const hostStudentId = body?.hostStudentId as string | undefined;
    const routeId = body?.routeId as string | undefined;
    if (!studentId || !routeId) {
      return NextResponse.json({ error: "태울 학생과 차량을 골라주세요." }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("shuttle_ride_alongs")
      .insert({
        service_date: (body?.serviceDate as string | undefined) || todayKst(),
        student_id: studentId,
        host_student_id: hostStudentId ?? null,
        route_id: routeId,
        status: "확정",
        note: (body?.note as string | undefined) ?? null,
        created_by: who,
        confirmed_by: who,
        confirmed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, row: data });
  }

  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  // ── 누구인지 골라서 확정 ──────────────────────────────────────────────────
  if (action === "resolve") {
    const studentId = body?.studentId as string | undefined;
    const routeId = body?.routeId as string | undefined;
    if (!studentId) return NextResponse.json({ error: "학생을 골라주세요." }, { status: 400 });

    // 노선을 안 보냈으면 태우는 아이의 배정에서 찾아봅니다.
    let route = routeId ?? null;
    if (!route) {
      const { data: row } = await supabase
        .from("shuttle_ride_alongs")
        .select("host_student_id")
        .eq("id", id)
        .maybeSingle();
      const hostId = row?.host_student_id as string | null;
      if (hostId) {
        const { data: asg } = await supabase
          .from("shuttle_assignments")
          .select("stop_id, override_route_id")
          .eq("student_id", hostId)
          .limit(1)
          .maybeSingle();
        route = (asg?.override_route_id as string | null) ?? null;
        if (!route && asg?.stop_id) {
          const { data: stop } = await supabase
            .from("shuttle_stops")
            .select("route_id")
            .eq("id", asg.stop_id as string)
            .maybeSingle();
          route = (stop?.route_id as string | null) ?? null;
        }
      }
    }
    if (!route) {
      // 어느 차인지 모르면 명단에 얹을 수 없습니다. 조용히 확정하면 아무 차에도 안 실립니다.
      return NextResponse.json({ error: "어느 차인지 정하지 못했습니다. 차량을 골라주세요." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("shuttle_ride_alongs")
      .update({
        student_id: studentId,
        route_id: route,
        status: "확정",
        confirmed_by: who,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, row: data });
  }

  // ── 취소 ─────────────────────────────────────────────────────────────────
  if (action === "cancel") {
    const { error } = await supabase
      .from("shuttle_ride_alongs")
      .update({ status: "취소", confirmed_by: who, confirmed_at: new Date().toISOString(), note: (body?.reason as string | undefined) ?? null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `모르는 동작입니다: ${action}` }, { status: 400 });
}
