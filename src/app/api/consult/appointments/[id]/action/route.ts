import { NextResponse } from "next/server";
import { consultSession, teacherOwnsAppt } from "@/lib/consult/access";
import { applyConsultAction, type ConsultAction } from "@/lib/consult/server";

export const dynamic = "force-dynamic";

/** 선생님(면담자)이 누를 수 있는 단추. 나머지(도착·배정·취소·전화상담)는 안내데스크의 일입니다. */
const TEACHER_ACTIONS = new Set<ConsultAction["kind"]>(["call", "start", "finish", "delay", "undo"]);

/** 예약 상태 바꾸기 — 단추 하나에 요청 하나. 기록은 `applyConsultAction` 이 남깁니다. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;

  const action = (await req.json().catch(() => null)) as ConsultAction | null;
  if (!action?.kind) return NextResponse.json({ error: "무엇을 할지 알 수 없습니다." }, { status: 400 });

  if (!s.staff) {
    if (!TEACHER_ACTIONS.has(action.kind)) return NextResponse.json({ error: "안내데스크에서 할 수 있는 일입니다." }, { status: 403 });
    if (!(await teacherOwnsAppt(s.supabase, s.me.email, id))) {
      return NextResponse.json({ error: "선생님 상담실의 예약이 아닙니다." }, { status: 403 });
    }
  }

  const res = await applyConsultAction(s.supabase, id, action, s.me.email);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true });
}
