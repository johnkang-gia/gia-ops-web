import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 매뉴얼 항목을 AI 제안 워크플로우를 거치지 않고 직접 새로 만들 때 사용합니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const targetDoc = body.targetDoc === "실무자용" ? "실무자용" : "학부모용";
  const category = String(body.category || "").trim();
  const content = String(body.content || "").trim();

  if (!category) {
    return NextResponse.json({ error: "항목(카테고리) 이름을 입력해주세요." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("manual_sections")
    .insert({ target_doc: targetDoc, category, content })
    .select()
    .single();

  if (error) {
    // unique(target_doc, category) 제약 위반 = 이미 같은 이름의 항목이 있음
    const message = error.code === "23505" ? "같은 이름의 항목이 이미 있습니다." : error.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true, section: data });
}
