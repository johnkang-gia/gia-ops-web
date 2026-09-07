import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 중앙 대시보드에서 교실 쪽지를 처리합니다(읽음 · 짧은 답 · 완료).
//
// 이 화면은 로그인 없는 토큰 링크입니다. 그래도 **여기서 처리할 수 있어야** 합니다 -
// 행정실이 실제로 보고 있는 화면이 이것인데, 처리하려면 다른 화면에 로그인해야 한다면
// 그 한 단계 때문에 «나중에»가 되고, 선생님 화면에는 영영 «보냄»으로 남습니다.
//
// 대신 할 수 있는 일을 좁혔습니다: 이미 온 쪽지에 읽음·짧은 답·완료만 찍습니다.
// 새 자료를 만들거나 학생 정보를 읽지 않습니다.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: link } = await db.from("ops_board_links").select("enabled").eq("token", token).maybeSingle();
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { id?: string; reply?: string; done?: boolean };
  if (!body.id) return NextResponse.json({ error: "어느 건인지 알 수 없습니다." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  // 읽음은 한 번만 찍습니다. 다시 볼 때마다 시각이 갱신되면 «언제 처음 봤나»가 사라집니다.
  patch.read_at = new Date().toISOString();
  patch.read_by = "행정실";
  if (body.reply) {
    patch.reply = body.reply;
    patch.replied_at = new Date().toISOString();
  }
  if (body.done) {
    patch.done_at = new Date().toISOString();
    patch.done_by = "행정실";
  }

  const { error } = await db.from("classroom_notes").update(patch).eq("id", body.id).is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 이미 읽은 건에 답·완료만 추가로 찍는 경우(위 update 는 read_at is null 조건이라 안 걸림).
  if (body.reply || body.done) {
    const after: Record<string, unknown> = {};
    if (body.reply) {
      after.reply = body.reply;
      after.replied_at = new Date().toISOString();
    }
    if (body.done) {
      after.done_at = new Date().toISOString();
      after.done_by = "행정실";
    }
    const { error: e2 } = await db.from("classroom_notes").update(after).eq("id", body.id);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
