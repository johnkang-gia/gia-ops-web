import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// 대시보드에서 학부모 문의를 처리(=목록에서 없애기).
//
// 요청: "학부모 문의 길게 눌러서 없앨수있고"
//
// 대시보드는 로그인 없는 토큰 링크라, 아무나 이 주소를 알면 누를 수 있습니다. 그래서
// 되돌릴 수 없는 삭제가 아니라 "처리 완료로 표시"만 합니다(지우지 않고 기록으로 남깁니다).
// 잘못 눌러도 [기록]에서 다시 찾아 되살릴 수 있습니다.

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 이 토큰이 살아 있는 대시보드 링크인지 확인합니다. 이게 열쇠 역할을 합니다.
  const { data: link } = await supabase
    .from("ops_board_links")
    .select("enabled")
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const { error } = await supabase
    .from("pickup_requests")
    .update({ answered_at: new Date().toISOString(), answered_via: "수동", answered_by: "대시보드" })
    .eq("id", id)
    .eq("kind", "문의");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
