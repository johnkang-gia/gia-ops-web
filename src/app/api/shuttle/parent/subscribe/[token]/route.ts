import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 학부모 테스트 화면이 "알림 받기"를 누르면 브라우저가 만들어준 PushSubscription을 저장하는
// 곳입니다. 로그인이 없으므로 shuttle_parent_links.token으로만 어느 학생 것인지 확인합니다
// (다른 파일럿/체크인 API와 같은 패턴).
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link, error: linkError } = await supabase
    .from("shuttle_parent_links")
    .select("student_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  const p256dh = body?.keys?.p256dh as string | undefined;
  const auth = body?.keys?.auth as string | undefined;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "구독 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const { error: upsertError } = await supabase
    .from("shuttle_push_subscriptions")
    .upsert({ student_id: link.student_id, endpoint, p256dh, auth }, { onConflict: "student_id,endpoint" });
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// "알림 끄기" - 이 기기 구독만 지웁니다.
export async function DELETE(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link } = await supabase.from("shuttle_parent_links").select("student_id").eq("token", token).maybeSingle();
  if (!link) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  if (!endpoint) return NextResponse.json({ error: "endpoint가 필요합니다." }, { status: 400 });

  await supabase.from("shuttle_push_subscriptions").delete().eq("student_id", link.student_id).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
