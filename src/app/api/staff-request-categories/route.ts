import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { logApiError } from "@/lib/logging";

// 행정요청 카테고리 등록 - 관리자만 가능합니다(요청: "위에 사물함파손,물품구입 등을 관리자가
// 등록/편집할 수 있게"). category 자체가 기본키라 한글 라벨을 그대로 값으로 씁니다(기존
// 사물함파손/물품구입/... 값과 같은 방식이라 별도 code/slug 입력을 받지 않아도 됩니다).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const me = await getCurrentAppUser();
  if (!isAdminUser(me)) {
    return NextResponse.json({ error: "관리자만 카테고리를 관리할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const category = String(body.category || "").trim();
  const labelEn = String(body.labelEn || "").trim();
  const icon = String(body.icon || "📎").trim() || "📎";

  if (!category) {
    return NextResponse.json({ error: "카테고리 이름(한글)을 입력해주세요." }, { status: 400 });
  }
  if (!labelEn) {
    return NextResponse.json({ error: "영문 이름을 입력해주세요." }, { status: 400 });
  }

  try {
    const { count } = await supabase
      .from("staff_request_categories")
      .select("category", { count: "exact", head: true });
    const { data, error } = await supabase
      .from("staff_request_categories")
      .insert({ category, label_en: labelEn, icon, sort_order: (count ?? 0) + 1 })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "staff-request-categories-create", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
