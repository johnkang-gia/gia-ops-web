import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkRevision, parseSince } from "@/lib/boardRevision";
import {
  ROOM_ACTIONS,
  applyConsultAction,
  buildRoomPayload,
  loadConsultState,
  roomActor,
  roomLinkOpen,
  type ConsultAction,
} from "@/lib/consult/server";

export const dynamic = "force-dynamic";

/**
 * **상담실 태블릿·QR 창구(로그인 없음).**
 *
 * 그날 어느 선생님이 어느 방에 들어갈지 미리 알 수 없어서, 「시작」·「종료」를 로그인한 담당
 * 선생님만 누르게 두면 계정 없는 분이 맡은 방은 상태가 멈춥니다. 그래서 **방마다 열쇠**를 두고,
 * 그 방에 놓인 태블릿이나 문에 붙인 QR을 찍은 휴대폰이면 누구든 누를 수 있게 합니다.
 *
 * 열쇠가 여는 것은 **그 방 하나**입니다. 다른 방의 예약은 고칠 수 없고 현황판과 같은 정도(가린 이름·
 * 방·상태)로만 보이며, 누를 수 있는 단추도 호출·시작·종료·지연·되돌리기 다섯 개뿐입니다. 기록에는 `상담실:방이름` 으로 남습니다.
 */

type Room = { id: string; event_id: string; name: string; consult_events: { status: "준비" | "진행" | "종료"; room_links_enabled: boolean } | null };

function service(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function roomOf(supabase: SupabaseClient, token: string): Promise<{ room: Room | null; error: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { room: null, error: null };
  const { data, error } = await supabase
    .from("consult_rooms")
    .select("id, event_id, name, consult_events(status, room_links_enabled)")
    .eq("room_token", token)
    .maybeSingle();
  if (error) return { room: null, error: error.message };
  const room = data as unknown as Room | null;
  if (!room?.consult_events || !roomLinkOpen(room.consult_events)) return { room: null, error: null };
  return { room, error: null };
}

const CLOSED = "닫힌 상담실 링크입니다. 행정실에 새 QR을 받아 주세요.";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const { room, error } = await roomOf(supabase, token);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!room) return NextResponse.json({ error: CLOSED }, { status: 403 });

  const rev = await checkRevision(supabase, "consult", parseSince(req.url), `room:${room.id}`);
  if (!rev.stale) return NextResponse.json({ unchanged: true, revision: rev.revision });

  const { state, error: stErr } = await loadConsultState(supabase, room.event_id, { phones: false });
  if (!state) return NextResponse.json({ error: stErr ?? "현황을 읽지 못했습니다." }, { status: 500 });
  const payload = buildRoomPayload(state, room.id, Date.now());
  if (!payload) return NextResponse.json({ error: CLOSED }, { status: 403 });
  return NextResponse.json({ room: payload, revision: rev.revision });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const { room, error } = await roomOf(supabase, token);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!room) return NextResponse.json({ error: CLOSED }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { appt_id?: string; updated_at?: string; action?: ConsultAction } | null;
  const action = body?.action;
  if (!body?.appt_id || !action?.kind || !ROOM_ACTIONS.has(action.kind)) {
    return NextResponse.json({ error: "이 화면에서 할 수 있는 일이 아닙니다." }, { status: 400 });
  }

  // 이 방의 예약인지 확인합니다. 되돌리기는 방금 이 방에서 끝내 다음 방으로 넘어간 예약도 대상이라,
  // 지금 방이 아니어도 마지막 기록을 이 방 화면이 남겼으면 허락합니다.
  const { data: appt, error: aErr } = await supabase
    .from("consult_appointments")
    .select("id, event_id, room_id, updated_at")
    .eq("id", body.appt_id)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  const a = appt as { id: string; event_id: string; room_id: string | null; updated_at: string } | null;
  if (!a || a.event_id !== room.event_id) return NextResponse.json({ error: "이 행사의 예약이 아닙니다." }, { status: 404 });
  if (a.room_id !== room.id) {
    let ok = false;
    if (action.kind === "undo") {
      const { data: last } = await supabase
        .from("consult_status_log")
        .select("by_email")
        .eq("appointment_id", a.id)
        .order("at", { ascending: false })
        .limit(1)
        .maybeSingle();
      ok = (last as { by_email: string | null } | null)?.by_email === roomActor(room.name);
    }
    if (!ok) return NextResponse.json({ error: "이 상담실의 예약이 아닙니다. 화면을 새로 읽었습니다." }, { status: 409 });
  }
  // 화면이 본 모습과 지금이 다르면 누르지 않습니다. 안내데스크가 방금 바꾼 예약을 태블릿이 옛 화면
  // 그대로 덮으면 «상담중»이던 분이 다시 «대기»로 돌아갑니다.
  if (body.updated_at && body.updated_at !== a.updated_at) {
    return NextResponse.json({ error: "다른 곳에서 방금 바뀌었습니다. 화면을 새로 읽었으니 다시 확인해 주세요." }, { status: 409 });
  }

  const res = await applyConsultAction(supabase, a.id, action, roomActor(room.name));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true });
}
