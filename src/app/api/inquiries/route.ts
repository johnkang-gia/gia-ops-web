import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genCaseId } from "@/lib/caseId";
import { logApiError } from "@/lib/logging";

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

  if (!["오류", "기능제안", "기타"].includes(category)) {
    return NextResponse.json({ error: "category는 오류/기능제안/기타 중 하나여야 합니다." }, { status: 400 });
  }
  if (!title || !content) {
    return NextResponse.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("inquiries")
      .insert({
        case_id: genCaseId("INQ"),
        category,
        title,
        content,
        reporter_email: user.email,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "inquiries-create", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
