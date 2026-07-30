import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const update: Record<string, string | boolean> = {};
  if (typeof body.category === "string") update.category = body.category.trim();
  if (typeof body.content === "string") update.content = body.content;
  if (typeof body.requiresSignature === "boolean") update.requires_signature = body.requiresSignature;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "수정할 내용이 없습니다." }, { status: 400 });
  }
  if ("category" in update && !update.category) {
    return NextResponse.json({ error: "항목(카테고리) 이름은 비울 수 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("manual_sections")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const message = error.code === "23505" ? "같은 이름의 항목이 이미 있습니다." : error.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true, section: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { error } = await supabase.from("manual_sections").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
