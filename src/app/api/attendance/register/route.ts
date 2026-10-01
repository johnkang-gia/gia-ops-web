import { NextResponse } from "next/server";
import { applyRegister, type AttendanceAction } from "@/lib/attendanceApply";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { logApiError } from "@/lib/logging";

/**
 * **하원 체크표 → 출석부.** 체크표에서 결석을 찍으면 출석부에도 남기고, 되돌리면 그 줄을 지웁니다.
 *
 * 인박스 결석은 체크표로 갔는데 반대는 없었습니다. 하루 중 가장 많이 누르는 자리가 체크표라,
 * 거기서 찍은 결석이 출석부에 안 가면 출석부는 비어 있고 체크표만 맞는 상태가 됩니다 - 둘이
 * 다른 명단인데 어느 쪽도 오류로 안 보입니다.
 *
 * 셔틀 상태는 여기서 안 건드립니다 - 체크표가 이미 자기 손으로 바꿨습니다. 출석부 쪽만 따라갑니다.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const me = await getCurrentAppUser();
    if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const body = (await req.json().catch(() => null)) as { studentId?: string; serviceDate?: string; action?: string } | null;
    const studentId = (body?.studentId ?? "").trim();
    const serviceDate = (body?.serviceDate ?? "").trim();
    const action = body?.action as AttendanceAction | undefined;
    if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || (action !== "결석" && action !== "예정")) {
      return NextResponse.json({ error: "studentId · serviceDate · action(결석|예정)이 필요합니다." }, { status: 400 });
    }
    const r = await applyRegister(supabase, {
      studentId,
      serviceDate,
      action,
      actor: { email: me.email, name: me.name ?? null },
      source: "하원 체크표",
    });
    if (r.errors.length > 0) return NextResponse.json({ ok: false, register: r.register, error: r.errors.join(" / ") }, { status: 500 });
    return NextResponse.json({ ok: true, register: r.register });
  } catch (e) {
    await logApiError(supabase, "/api/attendance/register", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
