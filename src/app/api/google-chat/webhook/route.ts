import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import type { GoogleChatMirrorSourceKey } from "@/lib/types";

// Google Cloud Pub/Sub push 구독이 새 구글챗 메시지가 생길 때마다 이 라우트를 호출합니다(요청:
// "구글챗에 내용들을 우리앱에서 실시간으로 체크할 수 있는 방안"). 항상 빠르게 200을 돌려줘야
// Pub/Sub이 같은 메시지를 계속 재전송하지 않습니다 - 내부 처리 중 오류가 나도 500을 주면
// Pub/Sub이 재시도를 반복해 오류가 오류를 부르므로, 실패는 오류로그에만 남기고 항상 200으로
// 응답합니다.
export async function POST(req: NextRequest) {
  // Pub/Sub push 구독의 대상 URL에 "?secret=..." 을 붙여두고(가이드에서 안내), 그 값이 일치하는
  // 요청만 처리합니다. Google이 권장하는 정식 방법은 OIDC 토큰 검증이지만, HTTPS + 무작위
  // 비밀값 조합만으로도 URL을 모르는 외부에서 위조 메시지를 보내기는 사실상 불가능해서, 별도
  // 라이브러리 없이 구현 가능한 이 방식을 택했습니다.
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.GOOGLE_CHAT_WEBHOOK_SECRET || secret !== process.env.GOOGLE_CHAT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: true }); // 설정 전이면 조용히 흡수

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const body = await req.json();
    const dataB64: string | undefined = body?.message?.data;
    if (!dataB64) return NextResponse.json({ ok: true });

    // CloudEvents 속성은 Pub/Sub 메시지의 attributes에 ce-* 로 붙어 옵니다. 메시지 "생성"
    // 이벤트만 다루고(수정/삭제/반응 등은 무시), 나머지 타입은 조용히 흡수합니다.
    const ceType: string | undefined = body?.message?.attributes?.["ce-type"];
    if (ceType && ceType !== "google.workspace.chat.message.v1.created") {
      return NextResponse.json({ ok: true });
    }

    // 실제 메시지 내용은 base64로 인코딩된 JSON입니다 - 디코딩하면 Chat API의 Message
    // 리소스({ name, sender, text, createTime, space, ... })가 나옵니다.
    const decoded = JSON.parse(Buffer.from(dataB64, "base64").toString("utf-8"));

    const spaceName: string | undefined = decoded?.space?.name;
    const sourceKey: GoogleChatMirrorSourceKey | null =
      spaceName && spaceName === process.env.GOOGLE_CHAT_SPACE_ATTENDANCE
        ? "attendance"
        : spaceName && spaceName === process.env.GOOGLE_CHAT_SPACE_TEACHER_REQUESTS
          ? "teacher_requests"
          : null;
    if (!sourceKey || !decoded?.name || typeof decoded?.text !== "string") {
      return NextResponse.json({ ok: true });
    }

    // google_message_id에 unique 제약이 있어(schema.sql), Pub/Sub의 최소 1회 이상 전송(at-least
    // -once) 특성으로 같은 메시지가 중복 도착해도 upsert(ignoreDuplicates)로 한 번만 저장됩니다.
    await supabase.from("google_chat_mirror_messages").upsert(
      {
        source_key: sourceKey,
        google_message_id: decoded.name,
        google_space_id: spaceName ?? null,
        // Chat API의 sender는 기본적으로 표시 이름만 담고 있고(이메일은 별도 People API 조회가
        // 필요), 여기서는 표시 이름만으로도 "누가 보냈는지" 알아보기에 충분합니다.
        sender_display_name: decoded?.sender?.displayName ?? null,
        sender_email: decoded?.sender?.email ?? null,
        content: decoded.text,
        created_at_google: decoded.createTime ?? new Date().toISOString(),
      },
      { onConflict: "google_message_id", ignoreDuplicates: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    await logApiError(supabase, "google-chat-webhook", err);
    return NextResponse.json({ ok: true }); // Pub/Sub 재시도 폭주 방지 - 실패는 오류로그로만 추적
  }
}
