import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { logApiError } from "@/lib/logging";

// 행정요청 카테고리 편집(영문 이름/아이콘/표시 여부) - 관리자/행정직원이면 가능합니다(요청:
// "카테고리 관리는 교사 이외의 권한들이 전부 할 수 있게 해줘"). category(한글 이름) 자체는
// 기존 요청들이 참조하고 있어 바꾸지 않고, 삭제 대신 active=false로 숨겨서 새 요청 등록
// 화면의 선택지에서만 빠지게 합니다.
export async function PATCH(request: Request, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const me = await getCurrentAppUser();
  if (!isStaffOrAboveUser(me)) {
    return NextResponse.json({ error: "관리자/행정직원만 카테고리를 관리할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const payload: Record<string, unknown> = {};
  if (typeof body.labelEn === "string" && body.labelEn.trim()) payload.label_en = body.labelEn.trim();
  if (typeof body.icon === "string" && body.icon.trim()) payload.icon = body.icon.trim();
  if (typeof body.active === "boolean") payload.active = body.active;

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "변경할 내용이 없습니다." }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("staff_request_categories")
      .update(payload)
      .eq("category", decodeURIComponent(category))
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "staff-request-categories-update", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
