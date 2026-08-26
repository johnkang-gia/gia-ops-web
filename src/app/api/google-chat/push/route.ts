import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { pollNewMessages, type GoogleChatSourceKey } from "@/lib/googleChat";

// 구글챗에 새 메시지가 올라오는 **그 순간** Pub/Sub가 이 주소를 부릅니다.
//
// 이 라우트는 초인종입니다. 벨이 울리면 문을 열어 직접 확인하지, 문 밖에서 들리는 말을
// 그대로 믿지 않습니다. 즉 **알림에 실린 내용은 쓰지 않고**, 신호만 받고 우리 토큰으로
// 구글챗을 읽습니다(구독을 includeResource:false로 만든 이유).
//
// 그래서 이 엔드포인트는 위조에 강합니다 - 누가 가짜 벨을 눌러도 할 수 있는 최악이 "쓸데없이
// 구글챗을 한 번 더 읽게 만드는 것"이고, 그마저 아래 연타 방지에 걸립니다. 가짜 메시지가
// 인박스에 들어올 길은 없습니다.
export const maxDuration = 30;

const SOURCE_KEYS: GoogleChatSourceKey[] = ["attendance"];

// 연타 방지.
//
// 여러 명이 동시에 글을 올리면 벨이 연달아 울립니다. 한 번 읽으면 그 사이에 온 메시지가 모두
// 딸려오므로, 방금 읽었다면 이번 벨은 그냥 넘깁니다. 서버리스라 이 값은 인스턴스마다 따로
// 살아 있지만(완벽한 잠금은 아님), 중복 저장은 google_message_id의 unique 제약이 막아주므로
// 여기서는 "대체로 줄이는" 것으로 충분합니다.
const DEBOUNCE_MS = 2_000;
let lastPollAt = 0;

export async function POST(req: NextRequest) {
  // Pub/Sub 푸시 구독 주소에 넣어둔 비밀값입니다. 이게 이 엔드포인트의 유일한 자물쇠인데,
  // 위에 적은 이유로 열쇠가 새더라도 피해가 "한 번 더 읽기"에 그칩니다.
  const expected = process.env.GOOGLE_CHAT_PUSH_SECRET;
  if (!expected || req.nextUrl.searchParams.get("token") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (Date.now() - lastPollAt < DEBOUNCE_MS) {
    return NextResponse.json({ ok: true, skipped: "debounced" });
  }
  lastPollAt = Date.now();

  let newMessages = 0;
  for (const key of SOURCE_KEYS) {
    try {
      newMessages += await pollNewMessages(supabase, key);
    } catch (err) {
      await logApiError(supabase, `google-chat:push:${key}`, err);
      // 여기서 500을 돌려주면 Pub/Sub가 같은 알림을 계속 재시도합니다. 구글챗 토큰이 만료된
      // 상황이라면 재시도해도 똑같이 실패하므로, 실패를 기록만 하고 200으로 받아넘깁니다.
      // 놓친 메시지는 안전망으로 남겨둔 1분 폴링이 곧 가져옵니다.
    }
  }

  return NextResponse.json({ ok: true, newMessages });
}
