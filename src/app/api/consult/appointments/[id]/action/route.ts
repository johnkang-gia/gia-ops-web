import { NextResponse } from "next/server";
import { consultSession } from "@/lib/consult/access";
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

  // 면담하는 선생님은 그날 정해지므로 **어느 방이든** 호출·시작·종료를 누를 수 있습니다. 담당 방으로
  // 막아 두면, 다른 선생님이 대신 들어간 방은 «상담중»에 멈추고 대기 시간 계산이 통째로 틀어집니다.
  // 도착·배정·취소·전화상담은 여전히 안내데스크의 일입니다.
  if (!s.staff && !TEACHER_ACTIONS.has(action.kind)) {
    return NextResponse.json({ error: "안내데스크에서 할 수 있는 일입니다." }, { status: 403 });
  }

  const res = await applyConsultAction(s.supabase, id, action, s.me.email);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true });
}
