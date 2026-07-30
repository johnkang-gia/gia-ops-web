import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Adopted } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const { data: row, error: fetchErr } = await supabase.from("adopted").select("*").eq("id", id).single();
  if (fetchErr || !row) {
    return NextResponse.json({ error: fetchErr?.message || "채택예정 항목을 찾을 수 없습니다." }, { status: 404 });
  }
  const adopted = row as Adopted;
  if (!adopted.specific_text?.trim()) {
    return NextResponse.json({ error: "구체화한 최종 내용이 비어있습니다." }, { status: 400 });
  }

  const { data: existingSection } = await supabase
    .from("manual_sections")
    .select("id, content")
    .eq("target_doc", adopted.target_doc)
    .eq("category", adopted.category)
    .maybeSingle();

  if (existingSection) {
    const merged = `${existingSection.content}\n\n${adopted.specific_text}`.trim();
    const { error: updateErr } = await supabase
      .from("manual_sections")
      .update({ content: merged })
      .eq("id", existingSection.id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  } else {
    const { error: insertErr } = await supabase.from("manual_sections").insert({
      target_doc: adopted.target_doc,
      category: adopted.category,
      content: adopted.specific_text,
    });
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const { error: publishErr } = await supabase
    .from("adopted")
    .update({ publish: true, published_at: new Date().toISOString() })
    .eq("id", id);
  if (publishErr) return NextResponse.json({ error: publishErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
