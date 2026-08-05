import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { logApiError } from "@/lib/logging";
import { translateKoEn } from "@/lib/ai/translate";

// 행정 요청에 코멘트를 남깁니다(요청: "행정요청에 대해서 코멘트를 넣을 수 있게"). 등록자
// 본인이든 행정직원/관리자든 giamicro 계정이면 누구나 남길 수 있고(RLS가 최종 방어선),
// 코멘트도 요청 본문과 마찬가지로 한/영 번역을 함께 저장합니다(요청: "넣는 코멘트 모두 한,영
// 번역을 지원"). 저장되는 즉시 DB 트리거(bump_staff_request_comment_count)가 staff_requests.
// comment_count를 올려주고, 그 테이블은 이미 realtime 구독 중이라 교사의 "내가 등록한 요청"
// 목록에도 바로 반영됩니다(요청: "코멘트는 교사의 내가 등록한 요청에 실시간으로 반영").
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const content = String(body.content || "").trim();
  if (!content) {
    return NextResponse.json({ error: "코멘트 내용을 입력해주세요." }, { status: 400 });
  }

  try {
    const me = await getCurrentAppUser();
    const translated = await translateKoEn({ content });

    const { data, error } = await supabase
      .from("staff_request_comments")
      .insert({
        request_id: id,
        author_email: user.email,
        author_name: me?.name || user.email,
        content,
        content_ko: translated.content?.ko ?? null,
        content_en: translated.content?.en ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "requests-comment", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
