import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudioWithGroq } from "@/lib/ai/groq";
import { logApiError } from "@/lib/logging";

// 회의 라이브 녹음 중 짧은 구간(약 45초)마다 호출되는 경량 전사 라우트입니다. /api/ai/transcribe-audio
// 와 달리 Supabase Storage에 저장하지 않고 바로 OpenAI로 보내 지연을 최소화합니다(원본 녹음이
// 남지 않는 대신 훨씬 빠릅니다 - 라이브 모드는 정리된 텍스트만 남기는 방식입니다).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "오디오 데이터가 없습니다." }, { status: 400 });
    }

    const text = await transcribeAudioWithGroq(file, "segment.webm");
    return NextResponse.json({ success: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "transcribe-live-chunk", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
