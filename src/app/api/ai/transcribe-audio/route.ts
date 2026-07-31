import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudioWithGroq } from "@/lib/ai/groq";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const path = String(body.path || "");
  if (!path) return NextResponse.json({ error: "path가 필요합니다." }, { status: 400 });

  try {
    const { data: blob, error } = await supabase.storage.from("meeting-audio").download(path);
    if (error || !blob) {
      throw new Error(error?.message || "음성 파일을 불러오지 못했습니다.");
    }

    const filename = path.split("/").pop() || "audio.webm";
    const text = await transcribeAudioWithGroq(blob, filename);
    return NextResponse.json({ success: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
