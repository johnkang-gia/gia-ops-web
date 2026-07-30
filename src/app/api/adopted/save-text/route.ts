import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const specificText = String(body.specificText ?? "");
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const { error } = await supabase.from("adopted").update({ specific_text: specificText }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
