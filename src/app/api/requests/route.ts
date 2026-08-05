import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { genCaseId } from "@/lib/caseId";
import { logApiError } from "@/lib/logging";
import { STAFF_REQUEST_CATEGORIES } from "@/lib/types";

// 행정 요청(교사 → 행정직원) 등록 - 요청("교사는 행정부에... 요청하는 여러 일들(사물함파손,
// 물품구입, 아픈학생인계, 출결상황문의)"). requested_by_name은 클라이언트가 보낸 값을 믿지 않고
// 서버에서 로그인 계정 기준으로 채웁니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const category = String(body.category || "");
  const title = String(body.title || "").trim();
  const content = String(body.content || "").trim();
  const studentName = String(body.studentName || "").trim();

  if (!STAFF_REQUEST_CATEGORIES.includes(category as (typeof STAFF_REQUEST_CATEGORIES)[number])) {
    return NextResponse.json({ error: "분류를 선택해주세요." }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
  }

  try {
    const me = await getCurrentAppUser();
    const { data, error } = await supabase
      .from("staff_requests")
      .insert({
        case_id: genCaseId("REQ"),
        category,
        title,
        content,
        student_name: studentName || null,
        requested_by: user.email,
        requested_by_name: me?.name || user.email,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "requests-create", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
